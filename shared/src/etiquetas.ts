/** Etiquetas visibles de los estados internos. Una sola fuente para backend (actividad, correos) y frontend. */
import type { EstadoAprobacion, EstadoOperativo, Prioridad } from './types';

export const ESTADO_OPERATIVO_LABEL: Record<EstadoOperativo, string> = {
  backlog: 'Backlog',
  priorizado: 'Priorizado',
  en_ejecucion: 'En proceso',
  en_revision: 'En revisión',
  reprogramado: 'Reprogramado',
  bloqueado: 'Bloqueado',
  completado: 'Completado',
  cancelado: 'Cancelado',
};

export const ESTADO_APROBACION_LABEL: Record<EstadoAprobacion, string> = {
  no_aplica: 'Sin estado',
  pendiente_interno: 'Pendiente interno',
  pendiente_cliente: 'Pendiente cliente',
  aprobado: 'Aprobado',
  rechazado: 'Cambios solicitados',
};

export const PRIORIDAD_LABEL: Record<Prioridad, string> = { alta: 'Alta', media: 'Media', baja: 'Baja' };

/** Etiqueta de un valor que puede venir de fuera del tipo (auditoría, query): si no se conoce, el valor tal cual. */
export function etiqueta(tabla: Record<string, string>, valor: unknown): string {
  return tabla[String(valor)] ?? String(valor);
}
