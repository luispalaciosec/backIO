import type { RequerimientoMetricas } from '@backio/shared';

export type CampoOrden = 'fecha_entrega' | 'fecha_pedido' | 'prioridad' | 'estado' | 'persona' | 'proyecto' | 'titulo' | 'atraso' | 'sin_movimiento' | 'ultima_actualizacion' | 'horas' | 'aprobacion';
export type Dir = 'asc' | 'desc';

export const CAMPOS_ORDEN: { campo: CampoOrden; label: string }[] = [
  { campo: 'fecha_entrega', label: 'Fecha de entrega' },
  { campo: 'fecha_pedido', label: 'Fecha de pedido' },
  { campo: 'atraso', label: 'Días de atraso' },
  { campo: 'sin_movimiento', label: 'Días sin movimiento' },
  { campo: 'prioridad', label: 'Prioridad' },
  { campo: 'estado', label: 'Estado' },
  { campo: 'aprobacion', label: 'Aprobación' },
  { campo: 'persona', label: 'Persona (owner agencia)' },
  { campo: 'proyecto', label: 'Proyecto' },
  { campo: 'titulo', label: 'Título' },
  { campo: 'horas', label: 'Horas' },
  { campo: 'ultima_actualizacion', label: 'Última actualización' },
];

const PRIO: Record<string, number> = { alta: 0, media: 1, baja: 2 };
const ESTADO_ORDEN: Record<string, number> = { bloqueado: 0, en_ejecucion: 1, en_revision: 2, priorizado: 3, reprogramado: 4, backlog: 5, completado: 6, cancelado: 7 };
const APROB_ORDEN: Record<string, number> = { pendiente_cliente: 0, pendiente_interno: 1, aprobado: 2, rechazado: 3, no_aplica: 4 };

export function ordenarRequerimientos(
  items: RequerimientoMetricas[],
  campo: CampoOrden,
  dir: Dir,
  ctx: { nombres: Record<string, string>; proyectos: Record<string, string>; horas: Record<string, number> },
): RequerimientoMetricas[] {
  const key = (r: RequerimientoMetricas): string | number => {
    switch (campo) {
      case 'fecha_entrega': return r.fecha_entrega ?? (dir === 'asc' ? '9999' : '');
      case 'fecha_pedido': return r.fecha_pedido ?? (dir === 'asc' ? '9999' : '');
      case 'prioridad': return PRIO[r.prioridad] ?? 9;
      case 'estado': return ESTADO_ORDEN[r.estado_operativo] ?? 9;
      case 'aprobacion': return APROB_ORDEN[r.estado_aprobacion] ?? 9;
      case 'persona': return (r.owner_agencia[0] && ctx.nombres[r.owner_agencia[0]]) || (dir === 'asc' ? 'zzz' : '');
      case 'proyecto': return (r.proyecto_id && ctx.proyectos[r.proyecto_id]) || (dir === 'asc' ? 'zzz' : '');
      case 'titulo': return r.titulo_interno.toLowerCase();
      case 'atraso': return r.dias_atraso;
      case 'sin_movimiento': return r.dias_sin_movimiento;
      case 'ultima_actualizacion': return r.ultima_actualizacion;
      case 'horas': return ctx.horas[r.id] ?? 0;
    }
  };
  const mult = dir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => { const ka = key(a), kb = key(b); return (ka < kb ? -1 : ka > kb ? 1 : 0) * mult; });
}
