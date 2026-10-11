import { diaLocal } from './fechas';

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
 */
export function cerradaATiempo(completadoAt: string | null | undefined, fecha: string | null | undefined): boolean | null {
  const cierre = diaLocal(completadoAt);
  return cierre && fecha ? cierre <= fecha : null;
}
