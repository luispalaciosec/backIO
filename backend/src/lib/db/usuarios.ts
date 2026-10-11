import type { Usuario } from '@backio/shared';
import { type DbCtx, serviceClient, throwIf } from './client';

export async function listUsuarios(ctx: DbCtx): Promise<Usuario[]> {
  const { data, error } = await ctx.db.from('usuarios').select('*').eq('tenant_id', ctx.tenantId).eq('activo', true).order('nombre');
  throwIf(error);
  return (data ?? []) as Usuario[];
}

export async function getUsuarioByEmail(ctx: DbCtx, email: string): Promise<Usuario | null> {
  const { data, error } = await ctx.db.from('usuarios').select('*').eq('tenant_id', ctx.tenantId).ilike('email', email).maybeSingle();
  throwIf(error);
  return (data as Usuario) ?? null;
}

/** Usuario por email en cualquier tenant (service role): solo para «recuperar contraseña», que no tiene sesión. */
export async function usuarioPorEmailSinSesion(
  email: string,
): Promise<{ id: string; nombre: string; activo: boolean; tenant_id: string } | null> {
  const { data, error } = await serviceClient().from('usuarios').select('id, nombre, activo, tenant_id').eq('email', email).maybeSingle();
  throwIf(error);
  return data;
}
