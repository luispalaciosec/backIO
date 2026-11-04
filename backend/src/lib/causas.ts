/**
 * Causas pendientes del weekly (docs/16): reprogramaciones y reprocesos sin causa. No se borra ninguna: lo que se cerró hace
 * más de 15 días deja de pedirse, porque ya nadie puede responderlo con certeza (el 4/11/2026 había 516 sin causa, 371 de
 * septiembre). Lo cancelado tampoco se pide.
 */
import { sumarDias } from '@backio/shared';

export const DIAS_CAUSA_COMPLETADA = 15;

export interface TareaCausa {
  id: string;
  titulo_interno: string;
  cliente_id: string;
  proyecto_id: string | null;
  estado_operativo: string;
  completado_at: string | null;
}

/** Deja lo que todavía se puede responder y le pone el título real: antes las tareas cerradas salían como «Requerimiento». */
export function causasVigentes<X extends { requerimiento_id: string }>(
  filas: X[],
  tareas: TareaCausa[],
  hoy: string,
  alcance?: { clienteIds: string[]; proyectoIds: string[] },
): (X & { titulo: string; cliente_id: string })[] {
  const porId = new Map(tareas.map((t) => [t.id, t]));
  const corte = sumarDias(hoy, -DIAS_CAUSA_COMPLETADA);
  return filas.flatMap((x) => {
    const t = porId.get(x.requerimiento_id);
    if (!t || t.estado_operativo === 'cancelado') return [];
    if (t.estado_operativo === 'completado' && t.completado_at && t.completado_at.slice(0, 10) < corte) return [];
    if (alcance && !alcance.clienteIds.includes(t.cliente_id) && !(t.proyecto_id && alcance.proyectoIds.includes(t.proyecto_id))) return [];
    return [{ ...x, titulo: t.titulo_interno, cliente_id: t.cliente_id }];
  });
}
