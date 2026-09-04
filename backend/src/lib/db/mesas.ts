import type { Mesa } from '@backio/shared';
import { type DbCtx, throwIf, DbError } from './client';

export async function listMesas(ctx: DbCtx): Promise<Mesa[]> {
  const { data, error } = await ctx.db.from('mesas').select('*').eq('tenant_id', ctx.tenantId).order('nombre');
  throwIf(error);
  return (data ?? []) as Mesa[];
}

export async function getMesa(ctx: DbCtx, id: string): Promise<Mesa | null> {
  const { data, error } = await ctx.db.from('mesas').select('*').eq('tenant_id', ctx.tenantId).eq('id', id).maybeSingle();
  throwIf(error);
  return (data as Mesa) ?? null;
}

export async function resolverMesa(ctx: DbCtx, ref: string): Promise<Mesa | null> {
  const todas = await listMesas(ctx);
  const q = ref.toLowerCase();
  return todas.find((m) => m.id === ref) ?? todas.find((m) => m.slug === q) ?? todas.find((m) => m.nombre.toLowerCase().includes(q)) ?? null;
}

export async function upsertMesa(ctx: DbCtx, m: Partial<Mesa> & { nombre: string; slug: string }): Promise<Mesa> {
  const { data, error } = await ctx.db.from('mesas').upsert({ ...m, tenant_id: ctx.tenantId }, { onConflict: 'tenant_id,slug' }).select().single();
  throwIf(error);
  return data as Mesa;
}

export async function updateMesa(ctx: DbCtx, id: string, patch: Partial<Pick<Mesa, 'nombre' | 'basecamp_project_id' | 'lider_id' | 'color' | 'activa'>>): Promise<Mesa> {
  const { data, error } = await ctx.db.from('mesas').update(patch).eq('tenant_id', ctx.tenantId).eq('id', id).select().single();
  throwIf(error);
  if (!data) throw new DbError('Mesa no encontrada', 404);
  return data as Mesa;
}

/** Clientes de una mesa + proyectos con override mesa_id. Devuelve los cliente_id y proyecto_id que caen en la mesa. */
export async function alcanceMesa(ctx: DbCtx, mesaId: string): Promise<{ clienteIds: string[]; proyectoIds: string[] }> {
  const [{ data: cl, error: e1 }, { data: pr, error: e2 }] = await Promise.all([
    ctx.db.from('clientes').select('id').eq('tenant_id', ctx.tenantId).eq('mesa_id', mesaId).is('deleted_at', null),
    ctx.db.from('proyectos').select('id, cliente_id, mesa_id').eq('tenant_id', ctx.tenantId).is('deleted_at', null),
  ]);
  throwIf(e1); throwIf(e2);
  const clienteIds = (cl ?? []).map((c) => (c as { id: string }).id);
  const set = new Set(clienteIds);
  // Proyectos de la mesa: los que la declaran explícitamente, o los de sus clientes sin override a otra mesa.
  const proyectoIds = ((pr ?? []) as { id: string; cliente_id: string; mesa_id: string | null }[])
    .filter((p) => p.mesa_id === mesaId || (p.mesa_id === null && set.has(p.cliente_id)))
    .map((p) => p.id);
  return { clienteIds, proyectoIds };
}
