export function fecha(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function fechaLarga(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(`${iso.slice(0, 10)}T12:00:00Z`),
  );
}

export const ESTADO_LABEL: Record<string, string> = {
  backlog: 'Backlog', priorizado: 'Priorizado', en_ejecucion: 'En ejecución', en_revision: 'En revisión',
  reprogramado: 'Reprogramado', bloqueado: 'Bloqueado', completado: 'Completado', cancelado: 'Cancelado',
};
export const APROBACION_LABEL: Record<string, string> = {
  no_aplica: '—', pendiente_interno: 'Pend. interno', pendiente_cliente: 'Esperando cliente', aprobado: 'Aprobado', rechazado: 'Rechazado',
};
