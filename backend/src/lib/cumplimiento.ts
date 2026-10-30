/**
 * Cumplimiento de fechas y reprocesos.
 *  - Cumplimiento ORIGINAL: completado_at <= fecha_entrega_original (el dato real de tiempos de entrega).
 *  - Cumplimiento VIGENTE: completado_at <= fecha_entrega (última fecha acordada).
 *  - Atribución: solo las reprogramaciones con motivo atribuible al equipo descuentan a la persona.
 */
import type {
  Requerimiento,
  RequerimientoMetricas,
  Reprogramacion,
  Reproceso,
  MotivoReprogramacion,
  MotivoReproceso,
  OrigenReproceso,
} from '@backio/shared';
import { MOTIVOS_REPROCESO, MOTIVOS_REPROGRAMACION, cerradaATiempo, entregaReal, diaLocal, porcentaje } from '@backio/shared';
import type { DbCtx } from './db/client';
import { getRequerimiento, updateRequerimiento } from './db/requerimientos';
import { insertReproceso, reprocesoAbierto, updateReproceso } from './db/historial';
import { audit } from './db/audit';
import { setVecesReproceso, getReproceso } from './db/cumplimiento';
import { listHorasRequerimientoDesde } from './db/horas';
import { reabrirTodo } from './basecamp/write';
import type { BasecampClient } from './basecamp/client';
import { log } from './logger';

// «A tiempo» compara el día de cierre en hora de Guayaquil (B4: antes se tomaba el día UTC).
const dia = diaLocal;

// Una tarea heredada por una salida y cerrada tarde da null: queda fuera del cálculo (docs/20).
// La entrega real es la que declaró el responsable, si lo hizo; si no, el cierre (entregaReal, migración 38).
export function aTiempoOriginal(
  r: Pick<Requerimiento, 'completado_at' | 'fecha_entrega_original' | 'heredada' | 'entregado_el'>,
): boolean | null {
  return cerradaATiempo(entregaReal(r), r.fecha_entrega_original, r.heredada);
}
export function aTiempoVigente(r: Pick<Requerimiento, 'completado_at' | 'fecha_entrega' | 'heredada' | 'entregado_el'>): boolean | null {
  return cerradaATiempo(entregaReal(r), r.fecha_entrega, r.heredada);
}
/** Días entre la fecha original y la entrega real (positivo = tarde). */
export function desvioDias(r: Pick<Requerimiento, 'completado_at' | 'fecha_entrega_original' | 'entregado_el'>): number | null {
  const c = dia(entregaReal(r));
  const f = r.fecha_entrega_original;
  if (!c || !f) return null;
  return Math.round((new Date(`${c}T12:00:00Z`).getTime() - new Date(`${f}T12:00:00Z`).getTime()) / 86_400_000);
}
export function atribuibleEquipo(motivo: MotivoReprogramacion | null): boolean {
  return MOTIVOS_REPROGRAMACION.find((m) => m.valor === motivo)?.atribuible === 'equipo';
}
export function labelMotivoReprogramacion(m: MotivoReprogramacion | null): string {
  return m ? (MOTIVOS_REPROGRAMACION.find((x) => x.valor === m)?.label ?? m) : 'Sin causa';
}
export function labelMotivoReproceso(m: MotivoReproceso | null): string {
  return m ? (MOTIVOS_REPROCESO.find((x) => x.valor === m)?.label ?? m) : 'Sin causa';
}

export interface ResumenCumplimiento {
  entregados: number;
  a_tiempo_original: number;
  a_tiempo_vigente: number;
  pct_original: number | null;
  pct_vigente: number | null;
  desvio_mediana_dias: number | null;
  reprogramaciones: number;
  reprogramaciones_equipo: number;
  reprocesos: number;
  horas_reproceso: number;
  motivo_reprogramacion_dominante: string | null;
  motivo_reproceso_dominante: string | null;
}

function mediana(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round(((s[m - 1]! + s[m]!) / 2) * 10) / 10;
}
function dominante(xs: (string | null)[]): string | null {
  const c = new Map<string, number>();
  for (const x of xs) if (x) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** Agrega cumplimiento sobre un conjunto de completados y sus reprogramaciones/reprocesos. */
export function resumirCumplimiento(
  completados: RequerimientoMetricas[],
  reprogs: Reprogramacion[],
  reprocs: Reproceso[],
): ResumenCumplimiento {
  const conFecha = completados.filter((r) => aTiempoOriginal(r) !== null);
  const orig = conFecha.filter((r) => aTiempoOriginal(r)).length;
  const vig = completados.filter((r) => aTiempoVigente(r)).length;
  const conVig = completados.filter((r) => aTiempoVigente(r) !== null).length;
  return {
    entregados: completados.length,
    a_tiempo_original: orig,
    a_tiempo_vigente: vig,
    pct_original: porcentaje(orig, conFecha.length),
    pct_vigente: porcentaje(vig, conVig),
    desvio_mediana_dias: mediana(conFecha.map((r) => desvioDias(r)!).filter((d) => d > 0)),
    reprogramaciones: reprogs.length,
    reprogramaciones_equipo: reprogs.filter((x) => atribuibleEquipo(x.motivo)).length,
    reprocesos: reprocs.length,
    horas_reproceso: Math.round(reprocs.reduce((s, x) => s + (x.horas_reproceso ?? 0), 0) * 10) / 10,
    motivo_reprogramacion_dominante: dominante(reprogs.map((x) => x.motivo)) as string | null,
    motivo_reproceso_dominante: dominante(reprocs.map((x) => x.motivo)) as string | null,
  };
}

/**
 * Registra un reproceso: fila + contador + reabre la tarea (y el to-do en Basecamp si se pide).
 * Idempotente por tarea: si ya hay un reproceso abierto, lo devuelve sin crear otro.
 */
export async function registrarReproceso(
  ctx: DbCtx,
  requerimientoId: string,
  o: {
    origen: OrigenReproceso;
    motivo: MotivoReproceso | null;
    paso_retorno?: string | null;
    reabrir_basecamp?: boolean;
    observacion?: string | null;
    area_responsable?: string | null;
    atribuible?: string | null;
    /** La tarea estaba completada antes de este cambio (quien llama ya la reabrió en BackIO). */
    estabaCompletada?: boolean;
    /** Cliente de Basecamp de quien registra (su cuenta); sin él se usa la de la persona del ctx. */
    bc?: BasecampClient;
  },
): Promise<Reproceso> {
  const req = await getRequerimiento(ctx, requerimientoId);
  if (!req) throw new Error('Requerimiento no encontrado');
  const abierto = await reprocesoAbierto(ctx, requerimientoId);
  if (abierto) {
    if ((o.motivo && !abierto.motivo) || o.observacion)
      await updateReproceso(ctx, abierto.id, {
        motivo: o.motivo ?? abierto.motivo,
        paso_retorno: o.paso_retorno ?? abierto.paso_retorno,
        ...(o.observacion ? { observacion: o.observacion } : {}),
      });
    return abierto;
  }
  // Atribución por defecto desde el motivo si no viene explícita (KPIs de retrabajo por área).
  const resp = MOTIVOS_REPROCESO.find((m) => m.valor === o.motivo)?.responsable;
  const atribuible = o.atribuible ?? (resp === 'cliente' ? 'cliente' : resp ? 'equipo' : null);
  const area_responsable = o.area_responsable ?? (resp === 'ejecutiva' ? 'cuentas' : null);
  const rp = await insertReproceso(ctx, {
    requerimiento_id: requerimientoId,
    origen: o.origen,
    motivo: o.motivo,
    paso_retorno: o.paso_retorno ?? null,
    fecha_entrega_antes: req.fecha_entrega,
    observacion: o.observacion ?? null,
    atribuible,
    area_responsable,
  });
  await setVecesReproceso(ctx, requerimientoId, req.veces_reproceso + 1);
  const patch: Parameters<typeof updateRequerimiento>[2] = { ultima_actualizacion: new Date().toISOString() };
  if (
    req.estado_operativo === 'completado' ||
    req.estado_operativo === 'en_revision' ||
    req.estado_operativo === 'priorizado' ||
    req.estado_operativo === 'backlog'
  ) {
    patch.estado_operativo = 'en_ejecucion';
    patch.completado_at = null;
  }
  if (o.origen === 'cliente') patch.estado_aprobacion = 'rechazado';
  else if (req.estado_aprobacion === 'aprobado') patch.estado_aprobacion = 'pendiente_interno';
  await updateRequerimiento(ctx, requerimientoId, patch);
  await audit(ctx, {
    accion: 'reproceso',
    entidad: 'requerimiento',
    entidad_id: requerimientoId,
    detalle: { reproceso_id: rp.id, origen: o.origen, motivo: o.motivo, paso_retorno: o.paso_retorno ?? null },
  });
  // Antes solo se miraba el estado releído: cuando actualizarRequerimiento ya la había reabierto, el to-do de Basecamp
  // nunca se reabría (16/10/2026).
  if (o.reabrir_basecamp && req.basecamp_todo_id && (req.estado_operativo === 'completado' || o.estabaCompletada)) {
    reabrirTodo(ctx, req, o.bc).catch((err) =>
      log.error('[basecamp] no se pudo reabrir el to-do', err instanceof Error ? err.message : err),
    );
  }
  return rp;
}

/** Cierra el reproceso abierto: fecha de cierre y horas del timesheet consumidas desde que se abrió. */
export async function cerrarReproceso(ctx: DbCtx, requerimientoId: string, reprocesoId?: string): Promise<Reproceso | null> {
  const abierto = reprocesoId ? await getReproceso(ctx, reprocesoId) : await reprocesoAbierto(ctx, requerimientoId);
  if (!abierto || abierto.cerrado_at) return abierto ?? null;
  const horas = await listHorasRequerimientoDesde(ctx, requerimientoId, abierto.abierto_at.slice(0, 10));
  const total = horas.reduce((s, h) => s + Number(h.horas), 0);
  const cerrado_at = new Date().toISOString();
  await updateReproceso(ctx, abierto.id, { cerrado_at, horas_reproceso: Math.round(total * 100) / 100 });
  await audit(ctx, {
    accion: 'reproceso_cerrado',
    entidad: 'requerimiento',
    entidad_id: requerimientoId,
    detalle: { reproceso_id: abierto.id, horas: total },
  });
  return { ...abierto, cerrado_at, horas_reproceso: total };
}
