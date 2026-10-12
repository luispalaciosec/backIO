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
