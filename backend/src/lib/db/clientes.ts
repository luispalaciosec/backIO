import type { Cliente } from '@backio/shared';
import { type DbCtx, type FilaInsert, serviceClient, throwIf } from './client';

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
    .upsert({ id: c.id, tenant_id: ctx.tenantId, nombre: c.nombre, slug, activo: c.activo }, { onConflict: 'id' })
    .select()
    .single();
  throwIf(error);
  return data as Cliente;
}

export async function updateClienteConfig(
  ctx: DbCtx,
  id: string,
  patch: Partial<Pick<Cliente, 'basecamp_project_id' | 'color_primario' | 'logo_url' | 'config' | 'mesa_id'>>,
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

/** Cliente del tenant con el mismo slug o el mismo proyecto de Basecamp (para no duplicar al darlo de alta). */
export async function clienteDuplicado(ctx: DbCtx, slug: string, basecampProjectId: number | null): Promise<{ nombre: string } | null> {
  let q = ctx.db.from('clientes').select('id, nombre').eq('tenant_id', ctx.tenantId);
  q = basecampProjectId ? q.or(`slug.eq.${slug},basecamp_project_id.eq.${basecampProjectId}`) : q.eq('slug', slug);
  const { data, error } = await q.limit(1).maybeSingle();
  throwIf(error);
  return data;
}

export async function insertCliente(ctx: DbCtx, fila: Omit<FilaInsert<'clientes'>, 'tenant_id'>) {
  const { data, error } = await ctx.db
    .from('clientes')
    .insert({ ...fila, tenant_id: ctx.tenantId })
    .select()
    .single();
  return { data, error };
}

/** Cliente activo dueño de un proyecto de Basecamp, en cualquier tenant (webhook de Basecamp, sin sesión). */
export async function clientePorProyectoBasecamp(bucketId: number): Promise<{ id: string; tenant_id: string; nombre: string } | null> {
  const { data, error } = await serviceClient()
    .from('clientes')
    .select('id, tenant_id, nombre')
    .eq('basecamp_project_id', bucketId)
    .eq('activo', true)
    .is('deleted_at', null)
    .maybeSingle();
  throwIf(error);
  return data;
}

/** Proyecto de Basecamp guardado en BackIO para un cliente (fuente de verdad frente al payload del webhook). */
export async function proyectoBasecampDeCliente(tenantId: string, clienteId: string): Promise<number | null> {
  const { data, error } = await serviceClient()
    .from('clientes')
    .select('basecamp_project_id')
    .eq('id', clienteId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  throwIf(error);
  return data?.basecamp_project_id ?? null;
}

/** Logo que llega de PrometIO: solo se usa si el cliente aún no tiene uno. */
export async function ponerLogoSiFalta(ctx: DbCtx, clienteId: string, logoUrl: string): Promise<void> {
  const { error } = await ctx.db
    .from('clientes')
    .update({ logo_url: logoUrl })
    .eq('tenant_id', ctx.tenantId)
    .eq('id', clienteId)
    .is('logo_url', null);
  throwIf(error);
}

/**
 * Clientes de prueba (migración 34, p. ej. el del sandbox de Basecamp): sus tareas no cuentan en señales, actas,
 * dashboard, KPIs ni informes. Si la columna todavía no existe (migración sin aplicar), no excluye a nadie.
 */
export async function idsClientesDePrueba(ctx: DbCtx): Promise<Set<string>> {
  const { data, error } = await ctx.db.from('clientes').select('id').eq('tenant_id', ctx.tenantId).eq('es_prueba', true);
  // Solo se tolera que la columna no exista todavía (migración 34 sin aplicar); otro error no deja pasar a los de prueba.
  if (error?.code === '42703') return new Set();
  throwIf(error);
  return new Set((data ?? []).map((c) => c.id));
}
