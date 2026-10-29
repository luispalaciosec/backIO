/**
 * Consultas de la administración (routes/v1/admin.ts): usuarios, invitaciones, API keys y auditoría.
 * Se respeta qué cliente usa cada una: las de la sesión pasan por RLS; las de credenciales y auditoría usan
 * service role porque RLS no deja leerlas (la ruta ya exige scope admin).
 */
import { finDiaLocal, inicioDiaLocal } from '@backio/shared';
import { type DbCtx, type FilaInsert, type FilaUpdate, serviceClient, throwIf } from './client';

// ---------------- usuarios
export async function vincularUsuarioBasecamp(ctx: DbCtx, usuarioId: string, basecampUserId: number, avatarUrl: string | null) {
  const { error } = await serviceClient()
    .from('usuarios')
    .update({ basecamp_user_id: basecampUserId, ...(avatarUrl ? { avatar_url: avatarUrl } : {}) })
    .eq('tenant_id', ctx.tenantId)
    .eq('id', usuarioId);
  throwIf(error);
}

export async function actualizarUsuario(ctx: DbCtx, id: string, patch: FilaUpdate<'usuarios'>) {
  const { data, error } = await ctx.db.from('usuarios').update(patch).eq('tenant_id', ctx.tenantId).eq('id', id).select().single();
  throwIf(error);
  return data;
}

export async function usuarioDelTenant(
  ctx: DbCtx,
  id: string,
): Promise<{ id: string; nombre: string; email: string; activo: boolean } | null> {
  const { data, error } = await serviceClient()
    .from('usuarios')
    .select('id, nombre, email, activo')
    .eq('tenant_id', ctx.tenantId)
    .eq('id', id)
    .maybeSingle();
  throwIf(error);
  return data;
}

export async function reactivarUsuario(ctx: DbCtx, id: string): Promise<void> {
  const { error } = await serviceClient().from('usuarios').update({ activo: true }).eq('tenant_id', ctx.tenantId).eq('id', id);
  throwIf(error);
}

// ---------------- invitaciones
export async function listInvitaciones(ctx: DbCtx) {
  const { data, error } = await ctx.db
    .from('invitaciones')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .order('created_at', { ascending: false });
  throwIf(error);
  return data ?? [];
}

export async function guardarInvitacion(
  ctx: DbCtx,
  inv: { email: string; nombre: string; rol: FilaInsert<'invitaciones'>['rol']; capacidad_semanal: number },
) {
  const { data, error } = await ctx.db
    .from('invitaciones')
    .upsert(
      { ...inv, email: inv.email.toLowerCase(), tenant_id: ctx.tenantId, created_by: ctx.usuarioId },
      { onConflict: 'tenant_id,email' },
    )
    .select()
    .single();
  throwIf(error);
  return data!;
}

export async function getInvitacion(ctx: DbCtx, id: string): Promise<{ email: string; nombre: string } | null> {
  const { data, error } = await ctx.db
    .from('invitaciones')
    .select('email, nombre')
    .eq('tenant_id', ctx.tenantId)
    .eq('id', id)
    .maybeSingle();
  throwIf(error);
  return data;
}

export async function borrarInvitacion(ctx: DbCtx, id: string): Promise<void> {
  const { error } = await ctx.db.from('invitaciones').delete().eq('tenant_id', ctx.tenantId).eq('id', id);
  throwIf(error);
}

// ---------------- api keys
export async function listApiKeys(ctx: DbCtx) {
  const { data, error } = await serviceClient()
    .from('api_keys')
    .select('id, nombre, prefijo, scopes, perfil, ultimo_uso_at, revocada_at, created_at')
    .eq('tenant_id', ctx.tenantId)
    .order('created_at', { ascending: false });
  throwIf(error);
  return data ?? [];
}

export async function clienteEsDelTenant(ctx: DbCtx, clienteId: string): Promise<boolean> {
  const { data, error } = await serviceClient()
    .from('clientes')
    .select('id')
    .eq('id', clienteId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  throwIf(error);
  return !!data;
}

export async function crearApiKey(ctx: DbCtx, fila: Omit<FilaInsert<'api_keys'>, 'tenant_id'>) {
  const { data, error } = await serviceClient()
    .from('api_keys')
    .insert({ ...fila, tenant_id: ctx.tenantId })
    .select('id, nombre, prefijo, scopes, perfil, created_at')
    .single();
  throwIf(error);
  return data!;
}

export async function revocarApiKey(ctx: DbCtx, id: string): Promise<void> {
  const { error } = await serviceClient()
    .from('api_keys')
    .update({ revocada_at: new Date().toISOString() })
    .eq('tenant_id', ctx.tenantId)
    .eq('id', id);
  throwIf(error);
}

// ---------------- auditoría
export interface FiltroAuditoria {
  usuario?: string;
  origen?: string;
  accion?: string;
  entidad?: string;
  desde?: string;
  hasta?: string;
}

/** Eventos de auditoría con filtros, más el total y cuántos parecen errores. */
export async function buscarAuditoria(ctx: DbCtx, f: FiltroAuditoria, limit: number) {
  const db = serviceClient();
  const filtrar = <
    Q extends {
      eq: (c: string, v: string) => Q;
      ilike: (c: string, v: string) => Q;
      gte: (c: string, v: string) => Q;
      lte: (c: string, v: string) => Q;
    },
  >(
    qb: Q,
  ): Q => {
    let x = qb.eq('tenant_id', ctx.tenantId);
    if (f.usuario) x = x.eq('usuario_id', f.usuario);
    if (f.origen) x = x.eq('origen', f.origen);
    if (f.accion) x = x.ilike('accion', `%${f.accion}%`);
    if (f.entidad) x = x.ilike('entidad', `%${f.entidad}%`);
    if (f.desde) x = x.gte('created_at', inicioDiaLocal(f.desde));
    if (f.hasta) x = x.lte('created_at', finDiaLocal(f.hasta));
    return x;
  };
  const [lista, total, errores] = await Promise.all([
    filtrar(db.from('audit_log').select('*')).order('created_at', { ascending: false }).limit(limit),
    filtrar(db.from('audit_log').select('id', { count: 'exact', head: true })),
    filtrar(db.from('audit_log').select('id', { count: 'exact', head: true })).or(
      'accion.ilike.%rechaz%,accion.ilike.%fall%,accion.ilike.%error%,accion.ilike.%invalid%,detalle->>error.not.is.null',
    ),
  ]);
  throwIf(lista.error);
  return { items: lista.data ?? [], total: total.count ?? 0, con_error: errores.count ?? 0 };
}
