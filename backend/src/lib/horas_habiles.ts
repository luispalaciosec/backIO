/**
 * Horas hábiles de Geeks: lunes a viernes 09:00–18:00 America/Guayaquil (UTC−5 todo el año, sin horario de verano).
 * Se usa para los SLA de primera respuesta (KPI-CUE-03) y de resolución de incidencias (KPI-CON-02).
 */
import type { Prioridad } from '@backio/shared';
import { SLA_MINUTOS } from '@backio/shared';

const OFFSET_MS = -5 * 3600_000;
const INICIO = 9 * 60, FIN = 18 * 60;

/** Minutos hábiles transcurridos entre dos instantes (0 si hasta <= desde). */
export function minutosHabiles(desde: Date, hasta: Date): number {
  if (hasta.getTime() <= desde.getTime()) return 0;
  // Se trabaja en "hora local" desplazando a UTC y leyendo con getUTC*.
  let t = new Date(desde.getTime() + OFFSET_MS);
  const fin = new Date(hasta.getTime() + OFFSET_MS);
  let total = 0;
  for (let guard = 0; guard < 400 && t < fin; guard++) {
    const dow = t.getUTCDay();
    const diaInicio = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
    if (dow !== 0 && dow !== 6) {
      const a = Math.max(t.getTime(), diaInicio + INICIO * 60_000);
      const b = Math.min(fin.getTime(), diaInicio + FIN * 60_000);
      if (b > a) total += (b - a) / 60_000;
    }
    t = new Date(diaInicio + 86_400_000);
  }
  return Math.round(total);
}

export function slaMinutos(prioridad: Prioridad): number {
  return SLA_MINUTOS[prioridad] ?? SLA_MINUTOS.media;
}

/** ¿Se cumplió el SLA de la prioridad entre `desde` y `hasta`? null si falta alguna fecha. */
export function dentroSla(prioridad: Prioridad, desde: string | null, hasta: string | null): boolean | null {
  if (!desde || !hasta) return null;
  return minutosHabiles(new Date(desde), new Date(hasta)) <= slaMinutos(prioridad);
}
