import type { TramoResponsable } from '@backio/shared';
import { throwIf, type DbCtx } from './client';

/**
 * Historial de responsables (migración 30) de un conjunto de tareas, agrupado por tarea. Sirve para atribuir una
 * reprogramación o un reproceso a quien tenía la tarea en ese momento, no a quien la tiene hoy.
 */
export async function tramosResponsables(ctx: DbCtx, ids: string[]): Promise<Map<string, TramoResponsable[]>> {
  const out = new Map<string, TramoResponsable[]>();
  const unicos = [...new Set(ids)];
  for (let i = 0; i < unicos.length; i += 200) {
    const { data, error } = await ctx.db
      .from('requerimiento_responsables')
      .select('requerimiento_id, usuario_id, desde, hasta')
      .eq('tenant_id', ctx.tenantId)
      .in('requerimiento_id', unicos.slice(i, i + 200));
    throwIf(error);
    for (const t of data ?? []) out.set(t.requerimiento_id, [...(out.get(t.requerimiento_id) ?? []), t]);
  }
  return out;
}
