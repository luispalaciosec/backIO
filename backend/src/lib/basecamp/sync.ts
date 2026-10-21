/**
 * Defensa 1 · Separación física (docs/02-visibilidad.md)
 *
 * De Basecamp entran ÚNICAMENTE: todo_id, completed, completed_at, due_on,
 * assignee_ids, updated_at. NADA MÁS. Ni content, ni description, ni comments,
 * ni attachments. Esta función es la única puerta y se construye campo a campo
 * (nunca spread del objeto recibido).
 */
import type { DbCtx } from '../db/client';
import { registrarReproceso, cerrarReproceso } from '../cumplimiento';
import { findByBasecampTodo, marcarDueOnVisto, updateRequerimiento } from '../db/requerimientos';
import { audit } from '../db/audit';
import { completarUltimaReprogramacion, fechaPendienteDeEnviar, ultimoCambioDeFechaEnBackio } from '../db/historial';
import { usuarioPorBasecampId } from '../db/usuarios';
import type { Requerimiento } from '@backio/shared';
import { log } from '../logger';

export interface BasecampSyncPayload {
  todo_id: number;
  /** null = el evento no informa el estado; hay que consultar el to-do vivo. */
  completed: boolean | null;
  bucket_id: number | null;
  completed_at: string | null;
  due_on: string | null;
  assignee_ids: number[];
  updated_at: string;
  /** true = el to-do fue enviado a la papelera o archivado; false = restaurado. */
  eliminado?: boolean;
  /** Persona de Basecamp que hizo el cambio (solo en webhooks: `creator` del evento). Un id, nunca texto. */
  actor_basecamp_id?: number;
}

const EVENTOS_TODO = new Set([
  'todo_completed',
  'todo_uncompleted',
  'todo_changed',
  'todo_created',
  'todo_assignment_changed',
  'todo_due_on_changed',
  'todo_unarchived',
  'todo_untrashed',
  'todo_trashed',
  'todo_archived',
]);
const EVENTOS_ELIMINADO = new Set(['todo_trashed', 'todo_archived']);
const EVENTOS_RESTAURADO = new Set(['todo_untrashed', 'todo_unarchived']);

/**
 * Extrae el payload seguro de un evento de webhook. Devuelve null si no es evento de to-do.
 * El `recording` del webhook es un resumen y puede no traer `completed`: el estado se deriva del
 * tipo de evento cuando es inequívoco (todo_completed / todo_uncompleted); si no, queda null y
 * el llamador consulta el to-do vivo.
 */
export function extractSafePayload(evento: unknown): BasecampSyncPayload | null {
  if (!evento || typeof evento !== 'object') return null;
  const e = evento as { kind?: unknown; recording?: unknown; creator?: { id?: unknown } };
  if (typeof e.kind !== 'string' || !EVENTOS_TODO.has(e.kind)) return null;
  const base = extractSafeTodo(e.recording);
  if (!base) return null;
  const rec = e.recording as Record<string, unknown>;
  const completed =
    e.kind === 'todo_completed' ? true : e.kind === 'todo_uncompleted' ? false : typeof rec.completed === 'boolean' ? rec.completed : null;
  const actor = e.creator && typeof e.creator.id === 'number' ? e.creator.id : undefined;
  return {
    ...base,
    completed,
    ...(actor !== undefined ? { actor_basecamp_id: actor } : {}),
    ...(EVENTOS_ELIMINADO.has(e.kind) ? { eliminado: true } : EVENTOS_RESTAURADO.has(e.kind) ? { eliminado: false } : {}),
  };
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
  /** Se aceptó la fecha que alguien puso en Basecamp (ya no hay que reenviar la de BackIO). */
  fecha_aceptada?: boolean;
}

/**
 * ¿La fecha distinta que tiene Basecamp la puso alguien allá? Sin `basecamp_due_on_visto` (tareas anteriores a la
 * migración 35, hasta la primera lectura en sincronía) se decide con el historial: si BackIO la cambió después, si
 * Basecamp sigue con la fecha anterior a ese cambio o si ese envío falló, manda BackIO.
 */
async function cambioSegunHistorial(ctx: DbCtx, req: Requerimiento, safe: BasecampSyncPayload): Promise<boolean> {
  const ultimoEnBackio = await ultimoCambioDeFechaEnBackio(ctx, req.id);
  if (!ultimoEnBackio) return true;
  if (Date.parse(ultimoEnBackio.created_at) >= Date.parse(safe.updated_at)) return false;
  if (ultimoEnBackio.fecha_anterior === safe.due_on) return false;
  const pendiente = await fechaPendienteDeEnviar(ctx, req.id);
  return !(pendiente && Date.parse(pendiente) >= Date.parse(ultimoEnBackio.created_at));
}

/**
 * Fecha cambiada en Basecamp (decisiones de Luis, 19 y 21/10/2026). BackIO guarda la última fecha que vio en Basecamp
 * (`basecamp_due_on_visto`, migración 35):
 *  - Basecamp tiene la misma que BackIO vio → nadie la tocó allá: manda BackIO (la reconciliación reenvía la suya).
 *  - Basecamp tiene otra → alguien la cambió allá: se acepta como reprogramación «desde Basecamp», sin motivo (queda en
 *    Causas pendientes), a nombre de quien la cambió si el webhook lo dice. Si BackIO también la cambió y su cambio es
 *    posterior, gana BackIO.
 * Sin comparar horas del to-do: un comentario en Basecamp mueve su hora y antes eso revertía cambios de BackIO.
 */
async function aceptarFechaDeBasecamp(ctx: DbCtx, req: Requerimiento, safe: BasecampSyncPayload): Promise<boolean> {
  if (!safe.due_on) return false;
  const visto = req.basecamp_due_on_visto ?? null;
  if (safe.due_on === req.fecha_entrega) {
    if (visto !== safe.due_on) await marcarDueOnVisto(ctx.tenantId, req.id, safe.due_on);
    return false;
  }
  const cambioEnBasecamp = visto ? safe.due_on !== visto : await cambioSegunHistorial(ctx, req, safe);
  if (!cambioEnBasecamp) return false;
  if (visto) {
    const ultimoEnBackio = await ultimoCambioDeFechaEnBackio(ctx, req.id);
    if (ultimoEnBackio && Date.parse(ultimoEnBackio.created_at) >= Date.parse(safe.updated_at)) return false;
  }
  await marcarDueOnVisto(ctx.tenantId, req.id, safe.due_on);
  if (req.estado_operativo === 'completado' || req.estado_operativo === 'cancelado') return false;
  const actor = safe.actor_basecamp_id ? await usuarioPorBasecampId(ctx, safe.actor_basecamp_id) : null;
  // El trigger de la base registra la reprogramación (y cuenta veces_reprogramado) con updated_by como autor.
  const ctxActor = { ...ctx, usuarioId: actor };
  await updateRequerimiento(ctxActor, req.id, { fecha_entrega: safe.due_on });
  // Sin fecha previa el trigger no crea reprogramación (poner fecha no es reprogramar): no hay fila que completar, y
  // completar la última «desconocido» pisaría una reprogramación vieja.
  if (req.fecha_entrega) await completarUltimaReprogramacion(ctxActor, req.id, { motivo: null, origen: 'basecamp' });
  await audit(ctx, {
    accion: 'basecamp_fecha_aceptada',
    entidad: 'requerimiento',
    entidad_id: req.id,
    detalle: { todo_id: safe.todo_id, de: req.fecha_entrega, a: safe.due_on, por: actor },
  });
  return true;
}

export async function applyBasecampUpdate(ctx: DbCtx, safe: BasecampSyncPayload): Promise<SyncResult> {
  const req = await findByBasecampTodo(ctx, safe.todo_id);
  if (!req) return { aplicado: false, motivo: 'to-do no gestionado por BackIO' };
  const tenantCtx0: DbCtx = { ...ctx, tenantId: req.tenant_id };
  // Eliminado o archivado en Basecamp → cancelado en BackIO. Restaurado → vuelve a En proceso.
  if (safe.eliminado === true) {
    if (req.estado_operativo === 'cancelado' || req.estado_operativo === 'completado')
      return { aplicado: false, requerimiento_id: req.id, motivo: 'ya cerrado' };
    await updateRequerimiento(tenantCtx0, req.id, { estado_operativo: 'cancelado', daily_fecha: null });
    await audit(tenantCtx0, {
      accion: 'basecamp_eliminado',
      entidad: 'requerimiento',
      entidad_id: req.id,
      detalle: { todo_id: safe.todo_id },
    });
    return { aplicado: true, requerimiento_id: req.id, motivo: 'eliminado en Basecamp' };
  }
  if (safe.eliminado === false && req.estado_operativo === 'cancelado') {
    await updateRequerimiento(tenantCtx0, req.id, { estado_operativo: reabrirEstado(req) });
    await audit(tenantCtx0, {
      accion: 'basecamp_restaurado',
      entidad: 'requerimiento',
      entidad_id: req.id,
      detalle: { todo_id: safe.todo_id },
    });
    return { aplicado: true, requerimiento_id: req.id, motivo: 'restaurado en Basecamp' };
  }
  const fechaAceptada = await aceptarFechaDeBasecamp(tenantCtx0, req, safe);
  if (safe.completed === null)
    return fechaAceptada
      ? { aplicado: true, requerimiento_id: req.id, motivo: 'fecha cambiada en Basecamp', fecha_aceptada: true }
      : { aplicado: false, requerimiento_id: req.id, motivo: 'evento sin estado; requiere consulta al to-do vivo' };

  const yaCompletado = req.estado_operativo === 'completado';
  const cancelado = req.estado_operativo === 'cancelado';
  if (cancelado) return { aplicado: false, requerimiento_id: req.id, motivo: 'requerimiento cancelado' };
  if (safe.completed === yaCompletado)
    return fechaAceptada
      ? { aplicado: true, requerimiento_id: req.id, motivo: 'fecha cambiada en Basecamp', fecha_aceptada: true }
      : { aplicado: false, requerimiento_id: req.id, motivo: 'sin cambios' };

  const tenantCtx: DbCtx = { ...ctx, tenantId: req.tenant_id };
  await updateRequerimiento(tenantCtx, req.id, {
    estado_operativo: safe.completed ? 'completado' : reabrirEstado(req),
    completado_at: safe.completed ? (safe.completed_at ?? new Date().toISOString()) : null,
    ultima_actualizacion: new Date().toISOString(),
  });
  await audit(tenantCtx, {
    accion: safe.completed ? 'basecamp_completado' : 'basecamp_reabierto',
    entidad: 'requerimiento',
    entidad_id: req.id,
    detalle: { todo_id: safe.todo_id, completed_at: safe.completed_at },
  });
  if (!safe.completed && yaCompletado) {
    // Un to-do completado que se desmarca en Basecamp es un reproceso (sin causa hasta que la mesa la complete).
    await registrarReproceso(tenantCtx, req.id, { origen: 'basecamp', motivo: null, reabrir_basecamp: false }).catch((err) =>
      log.error('[sync] reproceso no registrado', err instanceof Error ? err.message : err),
    );
  }
  if (safe.completed) {
    await cerrarReproceso(tenantCtx, req.id).catch(() => undefined);
  }
  return { aplicado: true, requerimiento_id: req.id, ...(fechaAceptada ? { fecha_aceptada: true } : {}) };
}
