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
  /** null = el evento no informa el estado; hay que consultar el to-do vivo. */
  completed: boolean | null;
  bucket_id: number | null;
  completed_at: string | null;
  due_on: string | null;
  assignee_ids: number[];
  updated_at: string;
}

const EVENTOS_TODO = new Set(['todo_completed', 'todo_uncompleted', 'todo_changed', 'todo_created', 'todo_assignment_changed', 'todo_due_on_changed', 'todo_unarchived']);

/**
 * Extrae el payload seguro de un evento de webhook. Devuelve null si no es evento de to-do.
 * El `recording` del webhook es un resumen y puede no traer `completed`: el estado se deriva del
 * tipo de evento cuando es inequívoco (todo_completed / todo_uncompleted); si no, queda null y
 * el llamador consulta el to-do vivo.
 */
export function extractSafePayload(evento: unknown): BasecampSyncPayload | null {
  if (!evento || typeof evento !== 'object') return null;
  const e = evento as { kind?: unknown; recording?: unknown };
  if (typeof e.kind !== 'string' || !EVENTOS_TODO.has(e.kind)) return null;
  const base = extractSafeTodo(e.recording);
  if (!base) return null;
  const rec = e.recording as Record<string, unknown>;
  const completed =
    e.kind === 'todo_completed' ? true
    : e.kind === 'todo_uncompleted' ? false
    : typeof rec.completed === 'boolean' ? rec.completed
    : null;
  return { ...base, completed };
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
  const bucket = r.bucket && typeof r.bucket === 'object' ? (r.bucket as { id?: unknown }).id : undefined;
  return {
    todo_id: r.id,
    completed: typeof r.completed === 'boolean' ? r.completed : null,
    bucket_id: typeof bucket === 'number' ? bucket : null,
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
  if (safe.completed === null) return { aplicado: false, requerimiento_id: req.id, motivo: 'evento sin estado; requiere consulta al to-do vivo' };

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
