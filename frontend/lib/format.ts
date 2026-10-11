import { ZONA, diaLocal, hoyLocal, ESTADO_OPERATIVO_LABEL, ESTADO_APROBACION_LABEL, PRIORIDAD_LABEL as PRIORIDAD_LABEL_SHARED } from '@backio/shared';
export function fecha(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [, m, d] = iso.slice(0, 10).split('-');
  return `${Number(d)} ${MESES[Number(m) - 1]}.`;
}

/** Fecha (YYYY-MM-DD) de un instante ISO con hora, en hora de Guayaquil. Definida en shared. */
export { diaLocal, hoyLocal };

export function fechaLarga(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-EC', { timeZone: ZONA, day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(`${iso.slice(0, 10)}T12:00:00Z`),
  );
}

export function haceCuanto(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
  const m = Math.floor(d / 30);
  if (m < 12) return `hace ${m} ${m === 1 ? 'mes' : 'meses'}`;
  const a = Math.floor(m / 12);
  return `hace ${a} ${a === 1 ? 'año' : 'años'}`;
}

// Etiquetas de estado: definidas en shared (también las usa el backend). Indexables por string para la UI.
export const ESTADO_LABEL: Record<string, string> = ESTADO_OPERATIVO_LABEL;
export const APROBACION_LABEL: Record<string, string> = ESTADO_APROBACION_LABEL;
export const PRIORIDAD_LABEL: Record<string, string> = PRIORIDAD_LABEL_SHARED;
export const TIPO_LABEL: Record<string, string> = { fee: 'FEE', proyecto: 'Proyecto' };

export function iniciales(nombre: string): string {
  return nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}
