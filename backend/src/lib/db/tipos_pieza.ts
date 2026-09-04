import type { TipoPieza, PasoPieza } from '@backio/shared';
import { type DbCtx, throwIf, DbError } from './client';

export async function listTiposPieza(ctx: DbCtx, incluirInactivos = false): Promise<TipoPieza[]> {
  let q = ctx.db.from('tipos_pieza').select('*').eq('tenant_id', ctx.tenantId).order('esfuerzo');
  if (!incluirInactivos) q = q.eq('activo', true);
  const { data, error } = await q;
  throwIf(error);
  return ((data ?? []) as TipoPieza[]).map((t) => ({ ...t, esfuerzo: Number(t.esfuerzo) }));
}

export async function upsertTipoPieza(ctx: DbCtx, t: { id?: string; nombre: string; slug: string; esfuerzo: number; pasos: PasoPieza[]; activo?: boolean }): Promise<TipoPieza> {
  const { data, error } = await ctx.db.from('tipos_pieza').upsert({ ...t, tenant_id: ctx.tenantId }, { onConflict: 'tenant_id,slug' }).select().single();
  throwIf(error);
  if (!data) throw new DbError('No se pudo guardar', 500);
  return { ...(data as TipoPieza), esfuerzo: Number((data as TipoPieza).esfuerzo) };
}
