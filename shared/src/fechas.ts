/**
 * Fechas de negocio: BackIO opera en hora de Guayaquil (UTC-5, sin horario de verano). En la base todo va en UTC;
 * aquí se decide a qué día local pertenece un instante y dónde empieza o termina un día local.
 * Una sola definición para backend y frontend (auditoría 10/10, B4 y B5).
 */
export const ZONA = 'America/Guayaquil';
const OFFSET = '-05:00';

const formatoDia = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Día local (YYYY-MM-DD) de un instante ISO. Si ya viene una fecha sin hora, se devuelve tal cual. */
export function diaLocal(iso: string): string;
export function diaLocal(iso: string | null | undefined): string | null;
export function diaLocal(iso: string | null | undefined): string | null {
  if (!iso) return null;
  if (iso.length <= 10) return iso;
  return formatoDia.format(new Date(iso));
}

/** Hoy en Guayaquil (YYYY-MM-DD). */
export function hoyLocal(ahora: Date = new Date()): string {
  return formatoDia.format(ahora);
}

/** Suma n días a una fecha YYYY-MM-DD (n puede ser negativo). */
export function sumarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Lunes de la semana de una fecha YYYY-MM-DD. */
export function lunesDe(dia: string): string {
  const dow = (new Date(`${dia}T12:00:00Z`).getUTCDay() + 6) % 7;
  return sumarDias(dia, -dow);
}

/** Instante ISO (UTC) en que empieza el día local. */
export function inicioDiaLocal(dia: string): string {
  return new Date(`${dia}T00:00:00${OFFSET}`).toISOString();
}

/** Último segundo del día local, como instante ISO (UTC). */
export function finDiaLocal(dia: string): string {
  return new Date(`${dia}T23:59:59${OFFSET}`).toISOString();
}
