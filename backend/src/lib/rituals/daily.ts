/**
 * Daily (docs/05): el daily no prioriza, desbloquea. Solo tres señales.
 */
import type { DailyView, Requerimiento } from '@backio/shared';
import { hoyLocal, sumarDias } from '@backio/shared';
import type { DbCtx } from '../db/client';
import { listBacklog } from '../db/requerimientos';
import { alcanceMesa } from '../db/mesas';
import { listEventosBloqueo, listReprogramacionesDesde } from '../db/evolutivo';

type FilaDaily = Pick<Requerimiento, 'id' | 'daily_fecha' | 'fecha_entrega' | 'estado_operativo' | 'ultima_actualizacion'>;

export interface SeccionesDaily<R> {
  hoy: R[];
  vencen: R[];
  bloqueos: R[];
  cambios: R[];
}

/** Hasta dónde se busca el paso a «bloqueado» de una tarea que sigue bloqueada. */
const DIAS_HISTORIA_BLOQUEO = 90;

/**
 * Las reglas del daily, una sola vez: las usan el tablero, el mensaje publicado y el borrador de la IA (antes cada uno
 * tenía las suyas y no coincidían; revisión del 29/10/2026).
 * - Cambios de fecha: los registrados en `reprogramaciones` en las últimas 24 h, que incluye los hechos en Basecamp.
 * - Bloqueo nuevo: la tarea pasó a «bloqueado» en las últimas 24 h según la auditoría. Si no hay registro del paso
 *   (bloqueo anterior a la auditoría), cuenta el último movimiento de la tarea.
 */
export async function seccionesDaily<R extends FilaDaily>(ctx: DbCtx, activos: R[], ahora = new Date()): Promise<SeccionesDaily<R>> {
  const hoy = hoyLocal(ahora);
  const manana = sumarDias(hoy, 1);
  const hace24h = new Date(ahora.getTime() - 86_400_000).toISOString();
  const bloqueadas = activos.filter((r) => r.estado_operativo === 'bloqueado');
  const [reprogramaciones, eventosBloqueo] = await Promise.all([
    listReprogramacionesDesde(ctx, hace24h),
    bloqueadas.length
      ? listEventosBloqueo(ctx, new Date(ahora.getTime() - DIAS_HISTORIA_BLOQUEO * 86_400_000).toISOString())
      : Promise.resolve([]),
  ]);
  const cambiadas = new Set(reprogramaciones.map((r) => r.requerimiento_id));
  const ultimoBloqueo = new Map<string, string>();
  for (const e of eventosBloqueo) if ((ultimoBloqueo.get(e.entidad_id) ?? '') < e.created_at) ultimoBloqueo.set(e.entidad_id, e.created_at);
  return {
    hoy: activos.filter((r) => r.daily_fecha === hoy),
    vencen: activos.filter((r) => r.fecha_entrega && r.fecha_entrega <= manana && r.estado_operativo === 'priorizado'),
    bloqueos: bloqueadas.filter((r) => (ultimoBloqueo.get(r.id) ?? r.ultima_actualizacion) >= hace24h),
    cambios: activos.filter((r) => cambiadas.has(r.id)),
  };
}

/** Daily acotado a una mesa (clientes y proyectos de la mesa). Sin mesa: toda la agencia. */
export async function getDaily(ctx: DbCtx, opts: { mesaId?: string } = {}): Promise<DailyView> {
  const mesa = opts.mesaId ? await alcanceMesa(ctx, opts.mesaId, { sinPrueba: true }) : undefined;
  const activos = await listBacklog(ctx, { solo_activos: true, mesa });
  const s = await seccionesDaily(ctx, activos);
  return {
    hoy_se_trabaja: s.hoy,
    vencen_hoy_o_manana_sin_iniciar: s.vencen,
    bloqueos_nuevos: s.bloqueos,
    fechas_cambiadas: s.cambios,
  };
}
