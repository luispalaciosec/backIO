/** Lecturas y escrituras puntuales de reprocesos que usa lib/cumplimiento. */
import type { Reproceso } from '@backio/shared';
import { type DbCtx, throwIf } from './client';

/** Fija el contador de reprocesos del requerimiento. */
export async function setVecesReproceso(ctx: DbCtx, requerimientoId: string, veces: number): Promise<void> {
  const { error } = await ctx.db
    .from('requerimientos')
    .update({ veces_reproceso: veces })
    .eq('tenant_id', ctx.tenantId)
    .eq('id', requerimientoId);
  throwIf(error);
}

/** Reproceso por id. Si la consulta falla devuelve null. */
export async function getReproceso(ctx: DbCtx, id: string): Promise<Reproceso | null> {
  return (await ctx.db.from('reprocesos').select('*').eq('tenant_id', ctx.tenantId).eq('id', id).maybeSingle()).data as Reproceso | null;
}
