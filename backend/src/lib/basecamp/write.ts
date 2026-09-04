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
  const pendientes = reqs.filter((r) => !r.basecamp_todo_id && r.estado_operativo !== 'cancelado');
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

  const bc = opts.bc ?? (await BasecampClient.forTenant(ctx.tenantId));
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
      const tl = await bc.createTodolist(bcProjectId, todosetId, { name: proyecto.nombre, description: `Gestionado desde BackIO. Entrega: ${proyecto.fecha_entrega}` });
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
      console.error(`[basecamp/write] fallo creando to-do para ${req.id}`, err);
    }
  }

  const sync_estado = fallidos === 0 ? 'ok' : 'incompleto';
  await updateProyecto(ctx, proyecto.id, { sync_estado });
  await audit(ctx, {
    accion: 'basecamp_crear_estructura', entidad: 'proyecto', entidad_id: proyecto.id,
    detalle: { todolist_id: todolistId, grupos, creados, fallidos, omitidos: reqs.length - pendientes.length },
  });
  return { todolist_id: todolistId, creados, omitidos: reqs.length - pendientes.length, fallidos, sync_estado };
}

/** Un solo requerimiento (creado a mano en el backlog dentro de un proyecto ya sincronizado). */
export async function pushRequerimiento(ctx: DbCtx, proyecto: Proyecto, req: Requerimiento): Promise<{ todo_id: number } | null> {
  if (req.basecamp_todo_id || !req.fecha_entrega || !proyecto.basecamp_todolist_id) return null;
  const cliente = await getCliente(ctx, proyecto.cliente_id);
  if (!cliente?.basecamp_project_id) return null;
  const bc = await BasecampClient.forTenant(ctx.tenantId);
  const usuarios = await listUsuarios(ctx);
  let destino = proyecto.basecamp_todolist_id;
  if (req.bloque_nombre) {
    const grupos = { ...(proyecto.basecamp_grupos ?? {}) };
    if (!grupos[req.bloque_nombre]) {
      const existentes = await bc.listGroups(cliente.basecamp_project_id, proyecto.basecamp_todolist_id);
      const match = existentes.find((g) => g.name.trim().toLowerCase() === req.bloque_nombre!.trim().toLowerCase());
      grupos[req.bloque_nombre] = match ? match.id : (await bc.createGroup(cliente.basecamp_project_id, proyecto.basecamp_todolist_id, req.bloque_nombre)).id;
      await updateProyecto(ctx, proyecto.id, { basecamp_grupos: grupos });
    }
    destino = grupos[req.bloque_nombre]!;
  }
  const todo = await bc.createTodo(cliente.basecamp_project_id, destino, {
    content: req.titulo_interno, due_on: req.fecha_entrega,
    assignee_ids: mapUsuariosABasecamp(req.owner_agencia, usuarios), completion_subscriber_ids: completionSubscribers(proyecto, usuarios),
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
  const client = bc ?? (await BasecampClient.forTenant(ctx.tenantId));
  await client.updateTodo(cliente.basecamp_project_id, req.basecamp_todo_id, { due_on: req.fecha_entrega });
}
