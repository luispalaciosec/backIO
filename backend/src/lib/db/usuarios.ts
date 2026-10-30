import type { Usuario } from '@backio/shared';
import { type DbCtx, serviceClient, throwIf } from './client';

/**
 * Personas del tenant. Por defecto solo las activas: son las que se pueden elegir y asignar.
 * `incluirInactivos` es para mostrar nombres e historia: quien se fue sigue siendo autor de lo que hizo.
 */
export async function listUsuarios(ctx: DbCtx, opts: { incluirInactivos?: boolean } = {}): Promise<Usuario[]> {
  let q = ctx.db.from('usuarios').select('*').eq('tenant_id', ctx.tenantId);
  if (!opts.incluirInactivos) q = q.eq('activo', true);
  const { data, error } = await q.order('nombre');
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

/** Lo que hace falta para validar que alguien conecta SU cuenta de Basecamp (service role: el callback no tiene sesión). */
export async function usuarioParaBasecamp(
  tenantId: string,
  usuarioId: string,
): Promise<{ id: string; email: string; activo: boolean; basecamp_user_id: number | null } | null> {
  const { data, error } = await serviceClient()
    .from('usuarios')
    .select('id, email, activo, basecamp_user_id')
    .eq('tenant_id', tenantId)
    .eq('id', usuarioId)
    .maybeSingle();
  throwIf(error);
  return data;
}

/** Enlaza a la persona con su usuario de Basecamp (cuando conecta su cuenta y aún no estaba enlazada). */
export async function fijarBasecampUserId(tenantId: string, usuarioId: string, basecampUserId: number): Promise<void> {
  const { error } = await serviceClient()
    .from('usuarios')
    .update({ basecamp_user_id: basecampUserId })
    .eq('tenant_id', tenantId)
    .eq('id', usuarioId)
    .is('basecamp_user_id', null);
  throwIf(error);
}

/** Persona activa de BackIO enlazada a una persona de Basecamp (para atribuir lo que hizo allá). */
export async function usuarioPorBasecampId(ctx: DbCtx, basecampUserId: number): Promise<string | null> {
  const { data, error } = await ctx.db
    .from('usuarios')
    .select('id')
    .eq('tenant_id', ctx.tenantId)
    .eq('basecamp_user_id', basecampUserId)
    .eq('activo', true)
    .limit(1)
    .maybeSingle();
  throwIf(error);
  return data?.id ?? null;
}

/** Personas activas con su preferencia de correo de «Mi día» (migración 38). */
export async function usuariosParaMiDia(tenantId: string): Promise<{ id: string; avisos_mi_dia: boolean }[]> {
  const { data, error } = await serviceClient().from('usuarios').select('id, avisos_mi_dia').eq('tenant_id', tenantId).eq('activo', true);
  throwIf(error);
  return data ?? [];
}

export async function getAvisosMiDia(ctx: DbCtx, usuarioId: string): Promise<boolean> {
  const { data, error } = await serviceClient()
    .from('usuarios')
    .select('avisos_mi_dia')
    .eq('tenant_id', ctx.tenantId)
    .eq('id', usuarioId)
    .maybeSingle();
  throwIf(error);
  return data?.avisos_mi_dia ?? true;
}

/** Service role: es la propia preferencia de la persona y la columna no está entre las que edita de sí misma. */
export async function setAvisosMiDia(ctx: DbCtx, usuarioId: string, correo: boolean): Promise<void> {
  const { error } = await serviceClient()
    .from('usuarios')
    .update({ avisos_mi_dia: correo })
    .eq('tenant_id', ctx.tenantId)
    .eq('id', usuarioId);
  throwIf(error);
}
