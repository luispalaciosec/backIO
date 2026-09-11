/** Paleta de celdas al estilo Monday: color sólido, texto blanco. */
export const COLOR_ESTADO: Record<string, string> = {
  backlog: '#C4C4C4',
  priorizado: '#579BFC',
  en_ejecucion: '#FDAB3D',
  en_revision: '#A25DDC',
  reprogramado: '#FF642E',
  bloqueado: '#E2445C',
  completado: '#0B7A3B', // verde oscuro (pedido de Luis 04/09)
  cancelado: '#808080',
};
export const COLOR_APROBACION: Record<string, string> = {
  no_aplica: '#C4C4C4',
  pendiente_interno: '#579BFC',
  pendiente_cliente: '#FDAB3D',
  aprobado: '#00C875',
  rechazado: '#0086C0',
};
export const COLOR_PRIORIDAD: Record<string, string> = { alta: '#401694', media: '#5559DF', baja: '#579BFC' };
export const COLOR_TIPO: Record<string, string> = { fee: '#A25DDC', proyecto: '#00C875' };

export const PALETA_GRUPOS = ['#0073EA', '#00C875', '#A25DDC', '#FDAB3D', '#E2445C', '#579BFC', '#FF642E', '#0086C0', '#9CD326', '#CAB641'];
export function colorGrupo(i: number, preferido?: string | null): string {
  return preferido && preferido !== '#0073EA' ? preferido : PALETA_GRUPOS[i % PALETA_GRUPOS.length]!;
}
export const COLOR_PLANIFICACION: Record<string, string> = { planificado: '#C4C4C4', no_planificado: '#FDAB3D', urgente: '#E2445C' };
