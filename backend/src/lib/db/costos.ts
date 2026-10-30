/**
 * Sueldos y fees (migración 41). La RLS solo deja leer y escribir a gerencia y admin; las rutas lo validan otra vez.
 * Se usa siempre el cliente de la persona (nunca service role), para que la RLS aplique. Sin borrado: un cambio es una
 * fila nueva con su fecha `desde`.
 */
import type { CostoPersonal, FeeCliente } from '@backio/shared';
import { throwIf, type DbCtx } from './client';

export async function listCostosPersonal(ctx: DbCtx): Promise<CostoPersonal[]> {
  const { data, error } = await ctx.db
    .from('costos_personal')
    .select('id, usuario_id, sueldo_mensual, desde, created_at')
    .eq('tenant_id', ctx.tenantId)
    .order('desde', { ascending: false });
  throwIf(error);
  return ((data ?? []) as CostoPersonal[]).map((c) => ({ ...c, sueldo_mensual: Number(c.sueldo_mensual) }));
}

export async function listFeesCliente(ctx: DbCtx): Promise<FeeCliente[]> {
  const { data, error } = await ctx.db
    .from('fees_cliente')
    .select('id, cliente_id, fee_mensual, desde, created_at')
    .eq('tenant_id', ctx.tenantId)
    .order('desde', { ascending: false });
  throwIf(error);
  return ((data ?? []) as FeeCliente[]).map((f) => ({ ...f, fee_mensual: Number(f.fee_mensual) }));
}

/** Guarda el sueldo desde una fecha; si ya había uno con esa misma fecha, lo reemplaza. */
export async function guardarCostoPersonal(ctx: DbCtx, x: { usuario_id: string; sueldo_mensual: number; desde: string }): Promise<void> {
  const { error } = await ctx.db
    .from('costos_personal')
    .upsert({ ...x, tenant_id: ctx.tenantId, created_by: ctx.usuarioId }, { onConflict: 'tenant_id,usuario_id,desde' });
  throwIf(error);
}

export async function guardarFeeCliente(ctx: DbCtx, x: { cliente_id: string; fee_mensual: number; desde: string }): Promise<void> {
  const { error } = await ctx.db
    .from('fees_cliente')
    .upsert({ ...x, tenant_id: ctx.tenantId, created_by: ctx.usuarioId }, { onConflict: 'tenant_id,cliente_id,desde' });
  throwIf(error);
}
