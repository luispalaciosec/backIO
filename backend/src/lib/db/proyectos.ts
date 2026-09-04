import type { Proyecto, Requerimiento, ProyectoDetalle, EstadoOperativo } from '@backio/shared';
import { type DbCtx, throwIf, DbError } from './client';

export interface FiltroProyectos {
  cliente_id?: string;
  estado?: EstadoOperativo;
}

export async function listProyectos(ctx: DbCtx, f: FiltroProyectos = {}): Promise<(Proyecto & { avance: number; cliente_nombre: string })[]> {
  let q = ctx.db
    .from('proyectos')
    .select('*, clientes!inner(nombre)')
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .order('fecha_entrega');
  if (f.cliente_id) q = q.eq('cliente_id', f.cliente_id);
  if (f.estado) q = q.eq('estado', f.estado);
  const { data, error } = await q;
  throwIf(error);
  const filas = (data ?? []) as (Proyecto & { clientes: { nombre: string } | null })[];
  const ids = filas.map((p) => p.id);
  const avances = new Map<string, number>();
  if (ids.length) {
    const { data: av, error: ea } = await ctx.db.from('v_proyectos_avance').select('proyecto_id, avance').in('proyecto_id', ids);
    throwIf(ea);
    for (const a of (av ?? []) as { proyecto_id: string; avance: number }[]) avances.set(a.proyecto_id, Number(a.avance));
  }
  return filas.map(({ clientes, ...p }) => ({ ...p, avance: avances.get(p.id) ?? 0, cliente_nombre: clientes?.nombre ?? '' }));
}

export async function getProyecto(ctx: DbCtx, id: string): Promise<Proyecto | null> {
  const { data, error } = await ctx.db
    .from('proyectos')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  throwIf(error);
  return (data as Proyecto) ?? null;
}

export async function getProyectoDetalle(ctx: DbCtx, id: string): Promise<ProyectoDetalle | null> {
  const p = await getProyecto(ctx, id);
  if (!p) return null;
  const [{ data: cl }, { data: reqs, error }] = await Promise.all([
    ctx.db.from('clientes').select('nombre').eq('id', p.cliente_id).maybeSingle(),
    ctx.db
      .from('requerimientos')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .eq('proyecto_id', id)
      .is('deleted_at', null)
      .order('fecha_entrega', { nullsFirst: false }),
  ]);
  throwIf(error);
  const requerimientos = ((reqs ?? []) as Requerimiento[]).map((r) => ({ ...r, peso: Number(r.peso) }));
  const activos = requerimientos.filter((r) => r.estado_operativo !== 'cancelado');
  const total = activos.reduce((s, r) => s + r.peso, 0);
  const hecho = activos.filter((r) => r.estado_operativo === 'completado').reduce((s, r) => s + r.peso, 0);
  return {
    ...p,
    cliente_nombre: (cl as { nombre: string } | null)?.nombre ?? '',
    requerimientos,
    avance: total === 0 ? 0 : Math.round((hecho / total) * 100),
  };
}

/** Portal: busca por token. Usa service role; el llamador DEBE sanitizar. */
export async function getProyectoByPortalToken(ctx: DbCtx, token: string): Promise<{ proyecto: Proyecto; requerimientos: Requerimiento[]; cliente: { nombre: string; logo_url: string | null; color_primario: string | null; config: Record<string, unknown> } } | null> {
  const { data: p, error } = await ctx.db
    .from('proyectos')
    .select('*')
    .eq('portal_token', token)
    .eq('portal_activo', true)
    .is('deleted_at', null)
    .maybeSingle();
  throwIf(error);
  if (!p) return null;
  const proyecto = p as Proyecto;
  const [{ data: reqs, error: er }, { data: cl, error: ec }] = await Promise.all([
    ctx.db.from('requerimientos').select('*').eq('proyecto_id', proyecto.id).is('deleted_at', null),
    ctx.db.from('clientes').select('nombre, logo_url, color_primario, config').eq('id', proyecto.cliente_id).single(),
  ]);
  throwIf(er);
  throwIf(ec);
  return {
    proyecto,
    requerimientos: ((reqs ?? []) as Requerimiento[]).map((r) => ({ ...r, peso: Number(r.peso) })),
    cliente: cl as { nombre: string; logo_url: string | null; color_primario: string | null; config: Record<string, unknown> },
  };
}

export interface InsertProyecto {
  cliente_id: string;
  plantilla_id: string | null;
  prometio_cotizacion_id?: string | null;
  nombre: string;
  brief: Record<string, unknown>;
  fecha_inicio: string;
  fecha_entrega: string;
  owner_ejecutiva?: string | null;
  portal_token: string;
}

export async function insertProyecto(ctx: DbCtx, p: InsertProyecto): Promise<Proyecto> {
  const { data, error } = await ctx.db
    .from('proyectos')
    .insert({ ...p, tenant_id: ctx.tenantId, created_by: ctx.usuarioId, updated_by: ctx.usuarioId })
    .select()
    .single();
  throwIf(error);
  return data as Proyecto;
}

export async function updateProyecto(
  ctx: DbCtx,
  id: string,
  patch: Partial<Pick<Proyecto, 'nombre' | 'estado' | 'fecha_entrega' | 'owner_ejecutiva' | 'portal_activo' | 'portal_token' | 'sync_estado' | 'basecamp_todolist_id' | 'brief' | 'deleted_at' | 'mesa_id' | 'basecamp_grupos' | 'basecamp_todoset_id' | 'valor_cotizado'>>,
): Promise<Proyecto> {
  const { data, error } = await ctx.db
    .from('proyectos')
    .update({ ...patch, updated_by: ctx.usuarioId })
    .eq('tenant_id', ctx.tenantId)
    .eq('id', id)
    .select()
    .single();
  throwIf(error);
  if (!data) throw new DbError('Proyecto no encontrado', 404);
  return data as Proyecto;
}
