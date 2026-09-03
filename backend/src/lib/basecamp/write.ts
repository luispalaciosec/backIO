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

  const cliente = await getCliente(ctx, proyecto.cliente_id);
  if (!cliente?.basecamp_project_id) throw new Error('Cliente sin proyecto Basecamp configurado');
  const bcProjectId = cliente.basecamp_project_id;

  const bc = opts.bc ?? (await BasecampClient.forTenant(ctx.tenantId));
  const usuarios = await listUsuarios(ctx);

  // Todolist: reutiliza si ya existe (idempotencia a nivel proyecto)
  let todolistId = proyecto.basecamp_todolist_id;
  if (!todolistId) {
    const todosetId = proyecto.basecamp_todoset_id ?? (await bc.getTodosetId(bcProjectId));
    const tl = await bc.createTodolist(bcProjectId, todosetId, {
      name: `${proyecto.nombre} · BackIO`,
      description: `Proyecto gestionado desde BackIO. Entrega: ${proyecto.fecha_entrega}`,
    });
    todolistId = tl.id;
    await updateProyecto(ctx, proyecto.id, { basecamp_todolist_id: todolistId });
  }

  let creados = 0;
  let fallidos = 0;
  for (const req of pendientes) {
    try {
      const todo = await bc.createTodo(bcProjectId, todolistId, {
        content: `[${req.bloque_nombre ?? 'General'}] ${req.titulo_interno}`,
        due_on: req.fecha_entrega,
        assignee_ids: mapUsuariosABasecamp(req.owner_agencia, usuarios),
      });
      await updateRequerimiento(ctx, req.id, {
        basecamp_todo_id: todo.id,
        basecamp_todolist_id: todolistId,
        basecamp_url: todo.app_url,
      });
      creados += 1;
    } catch (err) {
      fallidos += 1;
      console.error(`[basecamp/write] fallo creando to-do para ${req.id}`, err);
    }
  }

  const sync_estado = fallidos === 0 ? 'ok' : 'incompleto';
  await updateProyecto(ctx, proyecto.id, { sync_estado });
  await audit(ctx, {
    accion: 'basecamp_crear_estructura',
    entidad: 'proyecto',
    entidad_id: proyecto.id,
    detalle: { todolist_id: todolistId, creados, fallidos, omitidos: reqs.length - pendientes.length },
  });

  return { todolist_id: todolistId, creados, omitidos: reqs.length - pendientes.length, fallidos, sync_estado };
}

/** Reprogramación: BackIO manda sobre due_on. */
export async function pushDueDate(ctx: DbCtx, req: Requerimiento, bc?: BasecampClient): Promise<void> {
  if (!req.basecamp_todo_id) return;
  const cliente = await getCliente(ctx, req.cliente_id);
  if (!cliente?.basecamp_project_id) return;
  const client = bc ?? (await BasecampClient.forTenant(ctx.tenantId));
  await client.updateTodo(cliente.basecamp_project_id, req.basecamp_todo_id, { due_on: req.fecha_entrega });
}
