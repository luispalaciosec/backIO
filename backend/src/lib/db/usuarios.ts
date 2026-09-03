import type { Usuario } from '@backio/shared';
import { type DbCtx, throwIf } from './client';

export async function listUsuarios(ctx: DbCtx): Promise<Usuario[]> {
  const { data, error } = await ctx.db
    .from('usuarios')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .eq('activo', true)
    .order('nombre');
  throwIf(error);
  return (data ?? []) as Usuario[];
}

export async function getUsuario(ctx: DbCtx, id: string): Promise<Usuario | null> {
  const { data, error } = await ctx.db
    .from('usuarios')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .eq('id', id)
    .maybeSingle();
  throwIf(error);
  return (data as Usuario) ?? null;
}

export async function getUsuarioByEmail(ctx: DbCtx, email: string): Promise<Usuario | null> {
  const { data, error } = await ctx.db
    .from('usuarios')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .ilike('email', email)
    .maybeSingle();
  throwIf(error);
  return (data as Usuario) ?? null;
}
