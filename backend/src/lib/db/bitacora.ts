/** Bitácora por tarea: observaciones fechadas con el estado del momento (23/09/2026). */
import type { Bitacora } from '@backio/shared';
import { type DbCtx, throwIf } from './client';

export async function listBitacora(ctx: DbCtx, requerimientoId: string): Promise<Bitacora[]> {
  const { data, error } = await ctx.db.from('bitacora').select('*').eq('tenant_id', ctx.tenantId).eq('requerimiento_id', requerimientoId).order('created_at', { ascending: false });
  throwIf(error); return (data ?? []) as Bitacora[];
}

export async function insertBitacora(ctx: DbCtx, e: { requerimiento_id: string; nota: string; visible_cliente: boolean; estado_operativo: string | null; estado_aprobacion: string | null }): Promise<Bitacora> {
  const { data, error } = await ctx.db.from('bitacora').insert({ ...e, tenant_id: ctx.tenantId, usuario_id: ctx.usuarioId }).select().single();
  throwIf(error); return data as Bitacora;
}

export async function deleteBitacora(ctx: DbCtx, id: string): Promise<void> {
  const { error } = await ctx.db.from('bitacora').delete().eq('tenant_id', ctx.tenantId).eq('id', id);
  throwIf(error);
}

/**
 * Última nota por requerimiento. Con `hasta`, la última escrita hasta esa fecha (para el estatus de una semana);
 * con `ids`, solo esos requerimientos. Paginado: PostgREST corta en 1000 filas.
 */
export async function ultimaBitacoraPorRequerimiento(ctx: DbCtx, opts: { ids?: string[]; hasta?: string; dias?: number } = {}): Promise<Record<string, Bitacora>> {
  const out: Record<string, Bitacora> = {};
  const desde = opts.dias ? new Date(Date.now() - opts.dias * 86_400_000).toISOString() : null;
  for (let from = 0; ; from += 1000) {
    let q = ctx.db.from('bitacora').select('*').eq('tenant_id', ctx.tenantId).order('created_at', { ascending: false }).range(from, from + 999);
    if (opts.ids?.length) q = q.in('requerimiento_id', opts.ids.slice(0, 1000));
    if (opts.hasta) q = q.lte('created_at', opts.hasta);
    if (desde) q = q.gte('created_at', desde);
    const { data, error } = await q; throwIf(error);
    const filas = (data ?? []) as Bitacora[];
    for (const b of filas) if (!out[b.requerimiento_id]) out[b.requerimiento_id] = b;
    if (filas.length < 1000) break;
  }
  return out;
}
