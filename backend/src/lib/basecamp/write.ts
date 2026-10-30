/**
 * ============================================================================
 *  ZONA DE REVISIÓN HUMANA OBLIGATORIA  (CLAUDE.md · lib/basecamp/write.ts)
 *  Escribe en la producción real de la agencia. Revisar antes de habilitar.
 * ============================================================================
 *
 * Salvaguardas (docs/04-basecamp.md):
 *  - Máximo 50 to-dos por operación; sobre eso, confirmación explícita adicional.
 *  - Idempotencia: si basecamp_todo_id ya existe, no se recrea.
 *  - Rollback lógico: si falla a mitad, proyecto queda sync_estado='incompleto' y se puede reintentar.
 *  - BackIO nunca crea proyectos en Basecamp; solo listas dentro del proyecto del cliente.
 *  - Toda escritura nueva se prueba primero contra un proyecto sandbox.
 */
import type { Proyecto, Requerimiento, Usuario } from '@backio/shared';
import type { DbCtx } from '../db/client';
import { getCliente } from '../db/clientes';
import { updateProyecto } from '../db/proyectos';
import { updateRequerimiento } from '../db/requerimientos';
import { listUsuarios } from '../db/usuarios';
import { audit } from '../db/audit';
import { BasecampClient } from './client';
import { log } from '../logger';

export const LIMITE_TODOS_POR_OPERACION = 50; // decidido por Luis el 2026-09-03 (doc 04 decía 60)

export interface CreateStructureResult {
  todolist_id: number;
  creados: number;
  omitidos: number; // ya existían (idempotencia)
  fallidos: number;
  sync_estado: 'ok' | 'incompleto';
}

export function mapUsuariosABasecamp(ownerIds: string[], usuarios: Pick<Usuario, 'id' | 'basecamp_user_id'>[]): number[] {
  const byId = new Map(usuarios.map((u) => [u.id, u.basecamp_user_id]));
  return ownerIds.map((id) => byId.get(id)).filter((n): n is number => typeof n === 'number');
}

/** Ids de Basecamp de quienes reciben el aviso "when done": ejecutiva del proyecto + operaciones. */
function completionSubscribers(proyecto: Proyecto, usuarios: Usuario[]): number[] {
  const ids = new Set<number>();
  for (const u of usuarios) {
    if (!u.basecamp_user_id) continue;
    if (u.id === proyecto.owner_ejecutiva || u.rol === 'operaciones') ids.add(u.basecamp_user_id);
  }
  return [...ids];
}

export async function createProjectStructure(
  ctx: DbCtx,
  proyecto: Proyecto,
  reqs: Requerimiento[],
  opts: { confirmarSobreLimite?: boolean; bc?: BasecampClient } = {},
): Promise<CreateStructureResult> {
  // Ni canceladas ni completadas: una completada sin to-do se crearía abierta en Basecamp, el aviso de Basecamp la
  // reabriría en BackIO y quedaría un reproceso falso (escaneo del 13/10/2026).
  const pendientes = reqs.filter((r) => !r.basecamp_todo_id && r.estado_operativo !== 'cancelado' && r.estado_operativo !== 'completado');
  if (pendientes.length > LIMITE_TODOS_POR_OPERACION && !opts.confirmarSobreLimite) {
    throw new Error(
      `La operación crearía ${pendientes.length} to-dos (límite ${LIMITE_TODOS_POR_OPERACION}). Requiere confirmación explícita.`,
    );
  }
  const sinFecha = pendientes.filter((r) => !r.fecha_entrega);
  if (sinFecha.length) throw new Error(`${sinFecha.length} requerimiento(s) sin fecha de entrega. En Basecamp todo to-do lleva fecha.`);

  const cliente = await getCliente(ctx, proyecto.cliente_id);
  if (!cliente?.basecamp_project_id) throw new Error('Cliente sin proyecto Basecamp configurado');
  const bcProjectId = cliente.basecamp_project_id;

  const bc = opts.bc ?? (await BasecampClient.forActor(ctx));
  const usuarios = await listUsuarios(ctx);
  const subscribers = completionSubscribers(proyecto, usuarios);

  // Lista: reutiliza por id, si no por nombre (fidelidad con las listas que el equipo ya creó), si no la crea.
  let todolistId = proyecto.basecamp_todolist_id;
  const todosetId = proyecto.basecamp_todoset_id ?? (await bc.getTodosetId(bcProjectId));
  if (!todolistId) {
    const existentes = await bc.listTodolists(bcProjectId, todosetId);
    const match = existentes.find((l) => l.name.trim().toLowerCase() === proyecto.nombre.trim().toLowerCase());
    if (match) {
      todolistId = match.id;
    } else {
      const tl = await bc.createTodolist(bcProjectId, todosetId, {
        name: proyecto.nombre,
        description: `Gestionado desde BackIO. Entrega: ${proyecto.fecha_entrega}`,
      });
      todolistId = tl.id;
    }
    await updateProyecto(ctx, proyecto.id, { basecamp_todolist_id: todolistId });
  }

  // Grupos: uno por bloque, reutilizando por nombre.
  const grupos: Record<string, number> = { ...(proyecto.basecamp_grupos ?? {}) };
  const bloques = [...new Set(pendientes.map((r) => r.bloque_nombre).filter((b): b is string => !!b))];
  if (bloques.length) {
    const existentes = await bc.listGroups(bcProjectId, todolistId);
    for (const bloque of bloques) {
      if (grupos[bloque]) continue;
      const match = existentes.find((g) => g.name.trim().toLowerCase() === bloque.trim().toLowerCase());
      grupos[bloque] = match ? match.id : (await bc.createGroup(bcProjectId, todolistId, bloque)).id;
    }
    await updateProyecto(ctx, proyecto.id, { basecamp_grupos: grupos });
  }

  let creados = 0;
  let fallidos = 0;
  for (const req of pendientes) {
    try {
      const destino = (req.bloque_nombre && grupos[req.bloque_nombre]) || todolistId;
      const todo = await bc.createTodo(bcProjectId, destino, {
        content: req.titulo_interno,
        due_on: req.fecha_entrega,
        assignee_ids: mapUsuariosABasecamp(req.owner_agencia, usuarios),
        completion_subscriber_ids: subscribers,
      });
      await updateRequerimiento(ctx, req.id, { basecamp_todo_id: todo.id, basecamp_todolist_id: destino, basecamp_url: todo.app_url });
      creados += 1;
    } catch (err) {
      fallidos += 1;
      log.error(`[basecamp/write] fallo creando to-do para ${req.id}`, err);
    }
  }

  const sync_estado = fallidos === 0 ? 'ok' : 'incompleto';
  await updateProyecto(ctx, proyecto.id, { sync_estado });
  await audit(ctx, {
    accion: 'basecamp_crear_estructura',
    entidad: 'proyecto',
    entidad_id: proyecto.id,
    detalle: { todolist_id: todolistId, grupos, creados, fallidos, omitidos: reqs.length - pendientes.length },
  });
  return { todolist_id: todolistId, creados, omitidos: reqs.length - pendientes.length, fallidos, sync_estado };
}

/** Un solo requerimiento (creado a mano en el backlog dentro de un proyecto ya sincronizado). */
export async function pushRequerimiento(
  ctx: DbCtx,
  proyecto: Proyecto,
  req: Requerimiento,
  cliente_bc?: BasecampClient,
): Promise<{ todo_id: number } | null> {
  if (req.basecamp_todo_id || !req.fecha_entrega || !proyecto.basecamp_todolist_id) return null;
  const cliente = await getCliente(ctx, proyecto.cliente_id);
  if (!cliente?.basecamp_project_id) return null;
  const bc = cliente_bc ?? (await BasecampClient.forActor(ctx));
  const usuarios = await listUsuarios(ctx);
  let destino = proyecto.basecamp_todolist_id;
  if (req.bloque_nombre) {
    const grupos = { ...(proyecto.basecamp_grupos ?? {}) };
    if (!grupos[req.bloque_nombre]) {
      const existentes = await bc.listGroups(cliente.basecamp_project_id, proyecto.basecamp_todolist_id);
      const match = existentes.find((g) => g.name.trim().toLowerCase() === req.bloque_nombre!.trim().toLowerCase());
      grupos[req.bloque_nombre] = match
        ? match.id
        : (await bc.createGroup(cliente.basecamp_project_id, proyecto.basecamp_todolist_id, req.bloque_nombre)).id;
      await updateProyecto(ctx, proyecto.id, { basecamp_grupos: grupos });
    }
    destino = grupos[req.bloque_nombre]!;
  }
  const todo = await bc.createTodo(cliente.basecamp_project_id, destino, {
    content: req.titulo_interno,
    due_on: req.fecha_entrega,
    assignee_ids: mapUsuariosABasecamp(req.owner_agencia, usuarios),
    completion_subscriber_ids: completionSubscribers(proyecto, usuarios),
  });
  await updateRequerimiento(ctx, req.id, { basecamp_todo_id: todo.id, basecamp_todolist_id: destino, basecamp_url: todo.app_url });
  await audit(ctx, { accion: 'basecamp_crear_todo', entidad: 'requerimiento', entidad_id: req.id, detalle: { todo_id: todo.id } });
  return { todo_id: todo.id };
}

/** Reprogramación: BackIO manda sobre due_on. */
export async function pushDueDate(ctx: DbCtx, req: Requerimiento, bc?: BasecampClient): Promise<void> {
  if (!req.basecamp_todo_id) return;
  const cliente = await getCliente(ctx, req.cliente_id);
  if (!cliente?.basecamp_project_id) return;
  const client = bc ?? (await BasecampClient.forActor(ctx));
  await client.updateTodo(cliente.basecamp_project_id, req.basecamp_todo_id, { due_on: req.fecha_entrega });
}

/**
 * Reproceso: reabre el to-do en Basecamp (DELETE completion). Decidido por Luis 04/09/2026: automático cuando
 * la tarea tiene to-do enlazado. El webhook todo_uncompleted que vuelve NO crea otro reproceso (registrarReproceso es idempotente).
 */
export async function reabrirTodo(ctx: DbCtx, req: Requerimiento, bc?: BasecampClient): Promise<void> {
  if (!req.basecamp_todo_id) return;
  const cliente = await getCliente(ctx, req.cliente_id);
  if (!cliente?.basecamp_project_id) return;
  const client = bc ?? (await BasecampClient.forActor(ctx));
  await client.uncompleteTodo(cliente.basecamp_project_id, req.basecamp_todo_id);
  await audit(ctx, {
    accion: 'basecamp_reabrir_todo',
    entidad: 'requerimiento',
    entidad_id: req.id,
    detalle: { todo_id: req.basecamp_todo_id },
  });
}

/**
 * «¿Ya se entregó?» → «Sí, el día X» (docs/22, decisión de Luis 30/10/2026): completa el to-do en Basecamp con la cuenta
 * de quien responde. BackIO no marca la tarea como completada: lo hace la sincronización cuando Basecamp lo informa
 * (regla 3, Basecamp manda sobre completed). Sin to-do enlazado no hace nada.
 */
export async function completarTodo(ctx: DbCtx, req: Requerimiento, bc?: BasecampClient): Promise<boolean> {
  if (!req.basecamp_todo_id) return false;
  const cliente = await getCliente(ctx, req.cliente_id);
  if (!cliente?.basecamp_project_id) return false;
  const client = bc ?? (await BasecampClient.forActor(ctx));
  await client.completeTodo(cliente.basecamp_project_id, req.basecamp_todo_id);
  await audit(ctx, {
    accion: 'basecamp_completar_todo',
    entidad: 'requerimiento',
    entidad_id: req.id,
    detalle: { todo_id: req.basecamp_todo_id },
  });
  return true;
}

/**
 * Cancelar en BackIO archiva el to-do en Basecamp, a nombre de quien cancela; reabrir lo vuelve a dejar activo
 * (decisión de Luis, 28/10/2026: «Briefing Pasaportes» se canceló en BackIO y siguió abierto en Basecamp). Archivar,
 * no mandar a la papelera: se puede deshacer. El webhook todo_archived que vuelve no hace nada (la tarea ya está
 * cancelada).
 */
export async function archivarTodo(ctx: DbCtx, req: Requerimiento, archivar: boolean, bc?: BasecampClient): Promise<void> {
  if (!req.basecamp_todo_id) return;
  const cliente = await getCliente(ctx, req.cliente_id);
  if (!cliente?.basecamp_project_id) return;
  const client = bc ?? (await BasecampClient.forActor(ctx));
  await client.cambiarEstadoTodo(cliente.basecamp_project_id, req.basecamp_todo_id, archivar ? 'archived' : 'active');
  await audit(ctx, {
    accion: archivar ? 'basecamp_archivar_todo' : 'basecamp_restaurar_todo',
    entidad: 'requerimiento',
    entidad_id: req.id,
    detalle: { todo_id: req.basecamp_todo_id },
  });
}

/**
 * Asignados nuevos de un to-do cuando cambian los responsables en BackIO: la gente de Geeks (quienes tienen usuario en
 * BackIO, activos o no) se reemplaza por los responsables nuevos; los externos asignados que no existen en BackIO
 * (p. ej. el planner de Audela) se conservan.
 */
export function asignadosNuevos(vivos: number[], owners: string[], usuarios: Pick<Usuario, 'id' | 'basecamp_user_id'>[]): number[] {
  const deGeeks = new Set(usuarios.map((u) => u.basecamp_user_id).filter((n): n is number => typeof n === 'number'));
  return [...new Set([...vivos.filter((id) => !deGeeks.has(id)), ...mapUsuariosABasecamp(owners, usuarios)])];
}

/**
 * Responsables cambiados en BackIO → asignados del to-do en Basecamp, con la cuenta de quien hace el cambio
 * (decisión de Luis, 28/10/2026). Antes solo se enviaban al crear la tarea, y la sincronización cada 15 min volvía a
 * poner en BackIO los de Basecamp: reasignar en BackIO se deshacía solo. Lee los asignados vivos y reenvía el to-do
 * completo con updateTodo (incidente 22/09).
 */
export async function pushResponsables(ctx: DbCtx, req: Requerimiento, bc?: BasecampClient): Promise<void> {
  if (!req.basecamp_todo_id) return;
  const cliente = await getCliente(ctx, req.cliente_id);
  if (!cliente?.basecamp_project_id) return;
  const client = bc ?? (await BasecampClient.forActor(ctx));
  const usuarios = await listUsuarios(ctx, { incluirInactivos: true });
  const vivo = (await client.getTodoRaw(cliente.basecamp_project_id, req.basecamp_todo_id)) as { assignees?: { id: number }[] } | null;
  const vivos = (vivo?.assignees ?? []).map((a) => a.id);
  const nuevos = asignadosNuevos(vivos, req.owner_agencia, usuarios);
  await client.updateTodo(cliente.basecamp_project_id, req.basecamp_todo_id, { assignee_ids: nuevos });
  await audit(ctx, {
    accion: 'basecamp_responsables',
    entidad: 'requerimiento',
    entidad_id: req.id,
    detalle: { todo_id: req.basecamp_todo_id, antes: vivos, despues: nuevos },
  });
}

export interface CambioResponsableBasecamp {
  requerimientoId: string;
  projectId: number;
  todoId: number;
  /** Persona de Basecamp que sale del to-do. */
  sale: number;
  /** Persona de Basecamp que entra, o null si la tarea queda sin reemplazo. */
  entra: number | null;
}

/**
 * Salida de un colaborador: en cada to-do abierto, saca a quien se va y pone a quien lo reemplaza, sin tocar a los
 * demás asignados. Lee los asignados vivos del to-do (no los de BackIO) y escribe con updateTodo, que reenvía el
 * to-do completo (incidente 22/09). Tope de LIMITE_TODOS_POR_OPERACION por llamada: quien llama parte en lotes.
 * Un to-do que falla no detiene al resto; se devuelve para reintentarlo (Admin → Mantenimiento).
 */
export async function reemplazarResponsableEnTodos(
  ctx: DbCtx,
  cambios: CambioResponsableBasecamp[],
  bc?: BasecampClient,
): Promise<{ actualizados: number; sin_cambios: number; errores: { requerimientoId: string; error: string }[] }> {
  if (cambios.length > LIMITE_TODOS_POR_OPERACION) {
    throw new Error(`Como máximo ${LIMITE_TODOS_POR_OPERACION} to-dos por operación`);
  }
  const client = bc ?? (await BasecampClient.forActor(ctx));
  const r = { actualizados: 0, sin_cambios: 0, errores: [] as { requerimientoId: string; error: string }[] };
  for (const c of cambios) {
    try {
      const vivo = await client.request<{ assignees?: { id: number }[] }>('GET', `/buckets/${c.projectId}/todos/${c.todoId}.json`);
      const actuales = (vivo.assignees ?? []).map((a) => a.id);
      const nuevos = [...new Set([...actuales.filter((id) => id !== c.sale), ...(c.entra ? [c.entra] : [])])];
      if (nuevos.length === actuales.length && nuevos.every((id) => actuales.includes(id))) {
        r.sin_cambios += 1;
        continue;
      }
      await client.updateTodo(c.projectId, c.todoId, { assignee_ids: nuevos });
      r.actualizados += 1;
    } catch (e) {
      const error = e instanceof Error ? e.message : 'error';
      log.warn('[basecamp] no se pudo cambiar el responsable', c.todoId, error);
      r.errores.push({ requerimientoId: c.requerimientoId, error });
    }
  }
  return r;
}
