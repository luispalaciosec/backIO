import { diaLocal, sumarDias } from './fechas';

/** Porcentaje entero de a sobre b; null si no hay base. */
export function porcentaje(a: number, b: number): number | null {
  return b ? Math.round((a / b) * 100) : null;
}

/** Fracción (0–1) como porcentaje con un decimal: 0.875 → «87.5%». «—» si no hay dato. */
export function formatoFraccion(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${Math.round(v * 1000) / 10}%`;
}

/**
 * Día real de entrega de una tarea completada: el que declaró su responsable («¿ya se entregó?», migración 38) o, si no
 * lo declaró, el día en que se cerró. Se pasa a `cerradaATiempo` en lugar de `completado_at`: una tarea entregada a
 * tiempo y cerrada días después en Basecamp ya no cuenta como tarde.
 */
export function entregaReal(r: { completado_at: string | null; entregado_el?: string | null }): string | null {
  return r.entregado_el ?? r.completado_at;
}

/**
 * ¿Se cerró a tiempo? Compara el día de cierre en hora de Guayaquil con la fecha comprometida (inclusive).
 * null si falta alguno de los dos. Única definición de «a tiempo» para cumplimiento, KPIs, evolutivo, dashboard,
 * personas e informes (auditoría 10/10, B4).
 * Una tarea `heredada` (docs/20) cerrada tarde también da null: ese atraso no cuenta para nadie.
 */
export function cerradaATiempo(
  completadoAt: string | null | undefined,
  fecha: string | null | undefined,
  heredada = false,
): boolean | null {
  const cierre = diaLocal(completadoAt);
  if (!cierre || !fecha) return null;
  return cierre <= fecha ? true : heredada ? null : false;
}

/**
 * Quiénes responden por una tarea en las métricas: si está completada, los responsables al cierre (migración 30);
 * si no, los actuales. Así lo que cerró alguien que se fue sigue siendo suyo aunque después se edite.
 */
export function responsablesDe(r: { estado_operativo: string; owner_agencia: string[]; responsables_cierre?: string[] | null }): string[] {
  return r.estado_operativo === 'completado' && r.responsables_cierre?.length ? r.responsables_cierre : r.owner_agencia;
}

/** Tramo del historial de responsables (requerimiento_responsables). */
export interface TramoResponsable {
  requerimiento_id: string;
  usuario_id: string;
  desde: string;
  hasta: string | null;
}

/**
 * Responsables de una tarea en un instante, según el historial. Sin historial para esa tarea (anterior a la
 * migración 30), devuelve `porDefecto`.
 */
export function responsablesEn(tramos: TramoResponsable[], instante: string, porDefecto: string[]): string[] {
  if (!tramos.length) return porDefecto;
  const t = Date.parse(instante);
  const en = tramos.filter((x) => Date.parse(x.desde) <= t && (x.hasta === null || t < Date.parse(x.hasta))).map((x) => x.usuario_id);
  return en.length ? [...new Set(en)] : porDefecto;
}

/**
 * Margen mínimo, en días hábiles, para que quien recibe una tarea por la salida de un colaborador responda por su
 * atraso (decisión de Luis, 11/10/2026). Con menos margen, o ya vencida, la tarea queda «heredada».
 */
export const GRACIA_HEREDADA_DIAS = 3;

/** Días hábiles (lunes a viernes) después de `desde` y hasta `hasta` inclusive. 0 si `hasta` no es posterior. */
export function diasHabilesEntre(desde: string, hasta: string): number {
  let n = 0;
  for (let d = sumarDias(desde, 1); d <= hasta; d = sumarDias(d, 1)) {
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) n += 1;
  }
  return n;
}

/** ¿La tarea que se reasigna hoy llega con muy poco margen? Sin fecha de entrega no hay atraso posible: false. */
export function esHeredada(fechaEntrega: string | null | undefined, hoy: string): boolean {
  return !!fechaEntrega && diasHabilesEntre(hoy, fechaEntrega) < GRACIA_HEREDADA_DIAS;
}

export interface EventoAprobacion {
  requerimiento_id: string;
  estado_de: string | null;
  estado_a: string;
  created_at: string;
}
export interface TramoEsperaCliente {
  requerimiento_id: string;
  desde: string;
  /** null: sigue esperando. */
  hasta: string | null;
  dias: number;
}

/**
 * Tramos en que una tarea esperó al cliente: desde que su aprobación pasa a «pendiente del cliente» hasta que sale de
 * ese estado (aprobación, rechazo o cualquier otro). Sale de `aprobacion_eventos` (migración 22), así un cambio en la
 * tarea ya no reinicia la cuenta como pasaba con «días sin movimiento». Días con decimales redondeados a uno.
 */
export function tramosEsperaCliente(eventos: EventoAprobacion[], ahora = new Date()): TramoEsperaCliente[] {
  const ordenados = [...eventos].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const abiertos = new Map<string, string>();
  const tramos: TramoEsperaCliente[] = [];
  const dias = (a: string, b: number) => Math.round(((b - new Date(a).getTime()) / 86_400_000) * 10) / 10;
  for (const e of ordenados) {
    const abierto = abiertos.get(e.requerimiento_id);
    if (abierto && e.estado_a !== 'pendiente_cliente') {
      tramos.push({
        requerimiento_id: e.requerimiento_id,
        desde: abierto,
        hasta: e.created_at,
        dias: dias(abierto, new Date(e.created_at).getTime()),
      });
      abiertos.delete(e.requerimiento_id);
    } else if (!abierto && e.estado_a === 'pendiente_cliente') abiertos.set(e.requerimiento_id, e.created_at);
  }
  for (const [id, desde] of abiertos) tramos.push({ requerimiento_id: id, desde, hasta: null, dias: dias(desde, ahora.getTime()) });
  return tramos;
}

/** Mediana de una lista de números (null si está vacía), con un decimal. */
export function medianaDe(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round(((s[m - 1]! + s[m]!) / 2) * 10) / 10;
}
