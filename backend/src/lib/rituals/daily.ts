/**
 * Daily (docs/05): el daily no prioriza, desbloquea. Solo tres señales.
 */
import type { DailyView, Requerimiento } from '@backio/shared';
import type { DbCtx } from '../db/client';
import { listBacklog, requerimientosConFechaCambiadaDesde } from '../db/requerimientos';

export function fechaLocal(d: Date = new Date(), tz = 'America/Guayaquil'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function sumarDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function getDaily(ctx: DbCtx): Promise<DailyView> {
  const hoy = fechaLocal();
  const manana = sumarDias(hoy, 1);
  const hace24h = new Date(Date.now() - 86_400_000).toISOString();
  const activos = await listBacklog(ctx, { solo_activos: true });
  const cambiados = new Set(await requerimientosConFechaCambiadaDesde(ctx, hace24h));

  const strip = (r: Requerimiento): Requerimiento => r;
  return {
    hoy_se_trabaja: activos.filter((r) => r.daily_fecha === hoy).map(strip),
    vencen_hoy_o_manana_sin_iniciar: activos
      .filter((r) => r.fecha_entrega && r.fecha_entrega <= manana && r.estado_operativo === 'priorizado')
      .map(strip),
    bloqueos_nuevos: activos
      .filter((r) => r.estado_operativo === 'bloqueado' && r.ultima_actualizacion >= hace24h)
      .map(strip),
    fechas_cambiadas: activos.filter((r) => cambiados.has(r.id)).map(strip),
  };
}
