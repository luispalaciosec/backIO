/**
 * Defensa 1 · Separación física (docs/02-visibilidad.md)
 *
 * De Basecamp entran ÚNICAMENTE: todo_id, completed, completed_at, due_on,
 * assignee_ids, updated_at. NADA MÁS. Ni content, ni description, ni comments,
 * ni attachments. Esta función es la única puerta y se construye campo a campo
 * (nunca spread del objeto recibido).
 */
import type { DbCtx } from '../db/client';
import { findByBasecampTodo, updateRequerimiento } from '../db/requerimientos';
import { audit } from '../db/audit';
import type { Requerimiento } from '@backio/shared';

export interface BasecampSyncPayload {
  todo_id: number;
  completed: boolean;
  completed_at: string | null;
  due_on: string | null;
  assignee_ids: number[];
  updated_at: string;
}

const EVENTOS_TODO = new Set(['todo_completed', 'todo_uncompleted', 'todo_changed', 'todo_created', 'todo_assignment_changed']);

/** Extrae el payload seguro de un evento de webhook. Devuelve null si no es evento de to-do. */
export function extractSafePayload(evento: unknown): BasecampSyncPayload | null {
  if (!evento || typeof evento !== 'object') return null;
  const e = evento as { kind?: unknown; recording?: unknown };
  if (typeof e.kind !== 'string' || !EVENTOS_TODO.has(e.kind)) return null;
  return extractSafeTodo(e.recording);
}

/** Extrae el payload seguro de un objeto to-do (webhook o polling). */
export function extractSafeTodo(recording: unknown): BasecampSyncPayload | null {
  if (!recording || typeof recording !== 'object') return null;
  const r = recording as Record<string, unknown>;
  if (typeof r.id !== 'number') return null;
  const assignees = Array.isArray(r.assignees)
    ? r.assignees
        .map((a) => (a && typeof a === 'object' ? (a as { id?: unknown }).id : undefined))
        .filter((id): id is number => typeof id === 'number')
    : [];
  return {
    todo_id: r.id,
    completed: r.completed === true,
    completed_at: typeof r.completed_at === 'string' ? r.completed_at : null,
    due_on: typeof r.due_on === 'string' ? r.due_on : null,
    assignee_ids: assignees,
    updated_at: typeof r.updated_at === 'string' ? r.updated_at : new Date().toISOString(),
  };
}

/** Reapertura: si un to-do completado se desmarca, vuelve a en_ejecucion, no a backlog. */
export function reabrirEstado(_req: Pick<Requerimiento, 'estado_operativo'>): 'en_ejecucion' {
  return 'en_ejecucion';
}

export interface SyncResult {
  aplicado: boolean;
  requerimiento_id?: string;
  motivo?: string;
}

export async function applyBasecampUpdate(ctx: DbCtx, safe: BasecampSyncPayload): Promise<SyncResult> {
  const req = await findByBasecampTodo(ctx, safe.todo_id);
  if (!req) return { aplicado: false, motivo: 'to-do no gestionado por BackIO' };

  const yaCompletado = req.estado_operativo === 'completado';
  const cancelado = req.estado_operativo === 'cancelado';
  if (cancelado) return { aplicado: false, requerimiento_id: req.id, motivo: 'requerimiento cancelado' };
  if (safe.completed === yaCompletado) return { aplicado: false, requerimiento_id: req.id, motivo: 'sin cambios' };

  const tenantCtx: DbCtx = { ...ctx, tenantId: req.tenant_id };
  await updateRequerimiento(tenantCtx, req.id, {
    estado_operativo: safe.completed ? 'completado' : reabrirEstado(req),
    completado_at: safe.completed ? safe.completed_at ?? new Date().toISOString() : null,
    ultima_actualizacion: new Date().toISOString(),
  });
  await audit(tenantCtx, {
    accion: safe.completed ? 'basecamp_completado' : 'basecamp_reabierto',
    entidad: 'requerimiento',
    entidad_id: req.id,
    detalle: { todo_id: safe.todo_id, completed_at: safe.completed_at },
  });
  return { aplicado: true, requerimiento_id: req.id };
}
