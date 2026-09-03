import type { Cliente } from '@backio/shared';
import { type DbCtx, throwIf } from './client';

export async function listClientes(ctx: DbCtx, opts: { incluirInactivos?: boolean } = {}): Promise<Cliente[]> {
  let q = ctx.db.from('clientes').select('*').eq('tenant_id', ctx.tenantId).is('deleted_at', null).order('nombre');
  if (!opts.incluirInactivos) q = q.eq('activo', true);
  const { data, error } = await q;
  throwIf(error);
  return (data ?? []) as Cliente[];
}

export async function getCliente(ctx: DbCtx, id: string): Promise<Cliente | null> {
  const { data, error } = await ctx.db
    .from('clientes')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  throwIf(error);
  return (data as Cliente) ?? null;
}

export async function getClienteBySlug(ctx: DbCtx, slug: string): Promise<Cliente | null> {
  const { data, error } = await ctx.db
    .from('clientes')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .eq('slug', slug)
    .is('deleted_at', null)
    .maybeSingle();
  throwIf(error);
  return (data as Cliente) ?? null;
}

/** Upsert desde PrometIO. El id VIENE de PrometIO; nunca se genera aquí. */
export async function upsertClienteDesdePrometio(
  ctx: DbCtx,
  c: { id: string; nombre: string; activo: boolean; slug?: string },
): Promise<Cliente> {
  const slug = c.slug ?? slugify(c.nombre);
  const { data, error } = await ctx.db
    .from('clientes')
    .upsert(
      { id: c.id, tenant_id: ctx.tenantId, nombre: c.nombre, slug, activo: c.activo },
      { onConflict: 'id' },
    )
    .select()
    .single();
  throwIf(error);
  return data as Cliente;
}

export async function updateClienteConfig(
  ctx: DbCtx,
  id: string,
  patch: Partial<Pick<Cliente, 'basecamp_project_id' | 'color_primario' | 'logo_url' | 'config'>>,
): Promise<Cliente> {
  const { data, error } = await ctx.db
    .from('clientes')
    .update({ ...patch, updated_by: ctx.usuarioId })
    .eq('tenant_id', ctx.tenantId)
    .eq('id', id)
    .select()
    .single();
  throwIf(error);
  return data as Cliente;
}

export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
