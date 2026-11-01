/**
 * Daily (docs/05): el daily no prioriza, desbloquea. Solo tres señales.
 */
import type { CambioFecha, DailyView, Requerimiento } from '@backio/shared';
import { hoyLocal, sumarDias } from '@backio/shared';
import type { DbCtx } from '../db/client';
import { listBacklog } from '../db/requerimientos';
import { alcanceMesa, alcanceEjecutiva } from '../db/mesas';
import { listEventosBloqueo, listReprogramacionesDesde } from '../db/evolutivo';

type FilaDaily = Pick<Requerimiento, 'id' | 'daily_fecha' | 'fecha_entrega' | 'estado_operativo' | 'ultima_actualizacion'>;

export interface SeccionesDaily<R> {
  hoy: R[];
  vencen: R[];
  atrasadas: R[];
  bloqueos: R[];
  cambios: (R & { cambio: CambioFecha })[];
}

/** Hasta dónde se busca el paso a «bloqueado» de una tarea que sigue bloqueada. */
const DIAS_HISTORIA_BLOQUEO = 90;

/**
 * Las reglas del daily, una sola vez: las usan el tablero, el mensaje publicado y el borrador de la IA (antes cada uno
 * tenía las suyas y no coincidían; revisión del 29/10/2026).
 * - Vence: priorizada que vence hoy o mañana. Atrasada sin iniciar: priorizada con la fecha ya pasada, de la más vieja a la
 *   más nueva. Antes iban juntas bajo «Vence hoy o mañana» y la apertura del 30/10 listaba tareas con 63 días de atraso.
 * - Cambios de fecha: los registrados en `reprogramaciones` en las últimas 24 h, que incluye los hechos en Basecamp, con
 *   la fecha de antes, la nueva y el motivo.
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
  // Varias reprogramaciones de una tarea en 24 h: de la primera fecha anterior a la última nueva, con el último motivo.
  const cambiadas = new Map<string, CambioFecha>();
  for (const r of reprogramaciones) {
    const previo = cambiadas.get(r.requerimiento_id);
    cambiadas.set(r.requerimiento_id, {
      de: previo ? previo.de : r.fecha_anterior,
      a: r.fecha_nueva,
      motivo: r.motivo ?? previo?.motivo ?? null,
    });
  }
  const ultimoBloqueo = new Map<string, string>();
  for (const e of eventosBloqueo) if ((ultimoBloqueo.get(e.entidad_id) ?? '') < e.created_at) ultimoBloqueo.set(e.entidad_id, e.created_at);
  return {
    hoy: activos.filter((r) => r.daily_fecha === hoy),
    vencen: activos.filter(
      (r) => r.fecha_entrega && r.fecha_entrega >= hoy && r.fecha_entrega <= manana && r.estado_operativo === 'priorizado',
    ),
    atrasadas: activos
      .filter((r) => r.fecha_entrega && r.fecha_entrega < hoy && r.estado_operativo === 'priorizado')
      .sort((a, b) => a.fecha_entrega!.localeCompare(b.fecha_entrega!)),
    bloqueos: bloqueadas.filter((r) => (ultimoBloqueo.get(r.id) ?? r.ultima_actualizacion) >= hace24h),
    cambios: activos.filter((r) => cambiadas.has(r.id)).map((r) => ({ ...r, cambio: cambiadas.get(r.id)! })),
  };
}

/**
 * Daily acotado a una mesa (clientes y proyectos de la mesa) o a las cuentas de una ejecutiva («Mis cuentas», de
 * cualquier mesa; solo lectura: se publica por mesa). Sin ninguno: toda la agencia.
 */
export async function getDaily(ctx: DbCtx, opts: { mesaId?: string; ejecutivaId?: string } = {}): Promise<DailyView> {
  const mesa = opts.ejecutivaId
    ? await alcanceEjecutiva(ctx, opts.ejecutivaId)
    : opts.mesaId
      ? await alcanceMesa(ctx, opts.mesaId, { sinPrueba: true })
      : undefined;
  const activos = await listBacklog(ctx, { solo_activos: true, mesa });
  const s = await seccionesDaily(ctx, activos);
  return {
    hoy_se_trabaja: s.hoy,
    vencen_hoy_o_manana_sin_iniciar: s.vencen,
    atrasadas_sin_iniciar: s.atrasadas,
    bloqueos_nuevos: s.bloqueos,
    fechas_cambiadas: s.cambios,
  };
}

export type MotivoConfirmacion = 'ya_publicado' | 'otra_mesa' | 'tarde' | 'sin_hoy';

/** Desde esta hora (Guayaquil) una apertura pide confirmación: las de la mañana salen entre las 10:00 y las 13:30. */
export const HORA_APERTURA_TARDE = '14:00';

/**
 * Lo que hay que confirmar antes de publicar un daily que avisa a todo el equipo de la mesa. Pura: se prueba sin base.
 * Sale de la apertura de Omega del 30/10/2026, publicada a las 17:23 por una ejecutiva cuyas tareas del día eran de
 * Orión: «Hoy se trabaja: Nada» y 17 personas avisadas.
 * - otra_mesa: no es líder de la mesa, no tiene cuentas en ella y no la publicó en los últimos 30 días.
 * - tarde: apertura desde las 14:00.
 * - sin_hoy: apertura sin nada elegido para hoy; si la persona eligió tareas de hoy en otras mesas, se le dice cuáles.
 */
export function avisosAntesDePublicar(e: {
  tipo: 'apertura' | 'cierre';
  mesa: { id: string; nombre: string; lider_id: string | null };
  usuarioId: string | null;
  /** admin, gerencia y operaciones llevan cualquier mesa. */
  llevaTodas: boolean;
  /** Mesas donde la persona es ejecutiva de alguna cuenta. */
  mesasDeSusCuentas: Set<string>;
  /** Si publicó el daily de esta mesa en los últimos 30 días. */
  publicoAntes: boolean;
  hora: string;
  hoySeTrabaja: number;
  /** Nombres de las otras mesas donde la persona eligió tareas para hoy. */
  suHoyEnOtrasMesas: string[];
  liderNombre: string | null;
}): { motivo: MotivoConfirmacion; mensaje: string }[] {
  const out: { motivo: MotivoConfirmacion; mensaje: string }[] = [];
  const lleva = e.llevaTodas || !e.usuarioId || e.mesa.lider_id === e.usuarioId || e.mesasDeSusCuentas.has(e.mesa.id) || e.publicoAntes;
  if (!lleva)
    out.push({
      motivo: 'otra_mesa',
      mensaje: `No llevas la mesa ${e.mesa.nombre}${e.liderNombre ? ` (su líder es ${e.liderNombre})` : ''} ni tienes cuentas en ella.`,
    });
  if (e.tipo === 'apertura' && e.hora >= HORA_APERTURA_TARDE)
    out.push({ motivo: 'tarde', mensaje: `Son las ${e.hora}: la apertura es de la mañana.` });
  if (e.tipo === 'apertura' && e.hoySeTrabaja === 0)
    out.push({
      motivo: 'sin_hoy',
      mensaje: `Nadie eligió tareas de ${e.mesa.nombre} para hoy: saldría «Hoy se trabaja: Nada».${
        e.suHoyEnOtrasMesas.length ? ` Las tareas que elegiste para hoy son de ${e.suHoyEnOtrasMesas.join(' y ')}.` : ''
      }`,
    });
  return out;
}
