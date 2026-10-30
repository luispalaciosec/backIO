/** Informes para el cliente (migración 40, lib/clientes/informe.ts): historial de lo generado y editado. */
import type { InformeCliente } from '@backio/shared';
import { throwIf, type DbCtx } from './client';

const COLUMNAS = 'id, cliente_id, periodo, desde, hasta, asunto, cuerpo, generado_por, editado_por, editado_at, created_at';

export async function insertInformeCliente(
  ctx: DbCtx,
  x: Pick<InformeCliente, 'cliente_id' | 'periodo' | 'desde' | 'hasta' | 'asunto' | 'cuerpo'> & { datos: unknown },
): Promise<InformeCliente> {
  const { data, error } = await ctx.db
    .from('informes_cliente')
    .insert({ ...x, datos: x.datos as never, tenant_id: ctx.tenantId, generado_por: ctx.usuarioId })
    .select(COLUMNAS)
    .single();
  throwIf(error);
  return data as InformeCliente;
}

export async function listInformesCliente(ctx: DbCtx, clienteId: string, limite = 10): Promise<InformeCliente[]> {
  const { data, error } = await ctx.db
    .from('informes_cliente')
    .select(COLUMNAS)
    .eq('tenant_id', ctx.tenantId)
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: false })
    .limit(limite);
  throwIf(error);
  return (data ?? []) as InformeCliente[];
}

/** Guarda lo que editó la ejecutiva. null si el informe no es de ese cliente. */
export async function updateInformeCliente(
  ctx: DbCtx,
  clienteId: string,
  id: string,
  cambios: { asunto: string; cuerpo: string },
): Promise<InformeCliente | null> {
  const { data, error } = await ctx.db
    .from('informes_cliente')
    .update({ ...cambios, editado_por: ctx.usuarioId, editado_at: new Date().toISOString() })
    .eq('tenant_id', ctx.tenantId)
    .eq('cliente_id', clienteId)
    .eq('id', id)
    .select(COLUMNAS)
    .maybeSingle();
  throwIf(error);
  return (data as InformeCliente | null) ?? null;
}
