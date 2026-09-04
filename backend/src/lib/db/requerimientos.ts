import type {
  Requerimiento,
  RequerimientoMetricas,
  EstadoOperativo,
  CrearRequerimientoInput,
  ActualizarRequerimientoInput,
} from '@backio/shared';
import { type DbCtx, throwIf, DbError } from './client';

export interface FiltroBacklog {
  cliente_id?: string;
  proyecto_id?: string;
  owner?: string;
  estado?: EstadoOperativo | EstadoOperativo[];
  min_dias_atraso?: number;
  desde?: string; // fecha_entrega >=
  hasta?: string; // fecha_entrega <=
  solo_activos?: boolean;
  query?: string;
  /** Alcance de mesa: requerimientos de estos clientes O de estos proyectos */
  mesa?: { clienteIds: string[]; proyectoIds: string[] };
}

export async function listBacklog(ctx: DbCtx, f: FiltroBacklog = {}): Promise<RequerimientoMetricas[]> {
  let q = ctx.db.from('v_requerimientos_metricas').select('*').eq('tenant_id', ctx.tenantId);
  if (f.cliente_id) q = q.eq('cliente_id', f.cliente_id);
  if (f.proyecto_id) q = q.eq('proyecto_id', f.proyecto_id);
  if (f.owner) q = q.contains('owner_agencia', [f.owner]);
  if (f.estado) q = Array.isArray(f.estado) ? q.in('estado_operativo', f.estado) : q.eq('estado_operativo', f.estado);
  if (f.solo_activos) q = q.not('estado_operativo', 'in', '("completado","cancelado")');
  if (f.min_dias_atraso !== undefined) q = q.gte('dias_atraso', f.min_dias_atraso);
  if (f.desde) q = q.gte('fecha_entrega', f.desde);
  if (f.hasta) q = q.lte('fecha_entrega', f.hasta);
  if (f.query) q = q.ilike('titulo_interno', `%${f.query}%`);
  if (f.mesa) {
    const partes: string[] = [];
    if (f.mesa.clienteIds.length) partes.push(`cliente_id.in.(${f.mesa.clienteIds.join(',')})`);
    if (f.mesa.proyectoIds.length) partes.push(`proyecto_id.in.(${f.mesa.proyectoIds.join(',')})`);
    if (partes.length === 0) return [];
    q = q.or(partes.join(','));
  }
  q = q.order('fecha_entrega', { ascending: true, nullsFirst: false }).order('prioridad');
  const { data, error } = await q;
  throwIf(error);
  return ((data ?? []) as RequerimientoMetricas[]).map((r) => ({ ...r, peso: Number(r.peso) }));
}

export async function getRequerimiento(ctx: DbCtx, id: string): Promise<Requerimiento | null> {
  const { data, error } = await ctx.db
    .from('requerimientos')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  throwIf(error);
  return data ? ({ ...(data as Requerimiento), peso: Number((data as Requerimiento).peso) }) : null;
}

export async function findByBasecampTodo(ctx: DbCtx, todoId: number): Promise<Requerimiento | null> {
  const { data, error } = await ctx.db
    .from('requerimientos')
    .select('*')
    .eq('basecamp_todo_id', todoId)
    .is('deleted_at', null)
    .maybeSingle();
  throwIf(error);
  return (data as Requerimiento) ?? null;
}

export type InsertRequerimiento = CrearRequerimientoInput & {
  visible_cliente: boolean;
  plantilla_tarea_id?: string | null;
  fecha_entrega_original?: string | null;
  estado_operativo?: EstadoOperativo;
};

export async function insertRequerimientos(ctx: DbCtx, rows: InsertRequerimiento[]): Promise<Requerimiento[]> {
  if (rows.length === 0) return [];
  for (const r of rows) {
    if (r.visible_cliente && !r.etiqueta_cliente) {
      throw new DbError(`"${r.titulo_interno}": visible al cliente requiere etiqueta_cliente`, 422);
    }
  }
  const { data, error } = await ctx.db
    .from('requerimientos')
    .insert(rows.map((r) => ({ ...r, tenant_id: ctx.tenantId, created_by: ctx.usuarioId, updated_by: ctx.usuarioId })))
    .select();
  throwIf(error);
  return (data ?? []) as Requerimiento[];
}

export async function updateRequerimiento(
  ctx: DbCtx,
  id: string,
  patch: ActualizarRequerimientoInput & Partial<Pick<Requerimiento, 'basecamp_todo_id' | 'basecamp_todolist_id' | 'basecamp_url' | 'completado_at' | 'ultima_actualizacion' | 'deleted_at'>>,
): Promise<Requerimiento> {
  const { data, error } = await ctx.db
    .from('requerimientos')
    .update({ ...patch, updated_by: ctx.usuarioId })
    .eq('tenant_id', ctx.tenantId)
    .eq('id', id)
    .is('deleted_at', null)
    .select()
    .single();
  throwIf(error);
  if (!data) throw new DbError('Requerimiento no encontrado', 404);
  return data as Requerimiento;
}

export async function softDeleteRequerimiento(ctx: DbCtx, id: string): Promise<void> {
  await updateRequerimiento(ctx, id, { deleted_at: new Date().toISOString() });
}

/** Cambios de fecha_entrega en las últimas 24h (para el Daily). Usa audit_log. */
export async function requerimientosConFechaCambiadaDesde(ctx: DbCtx, desdeIso: string): Promise<string[]> {
  const { data, error } = await ctx.db
    .from('audit_log')
    .select('entidad_id')
    .eq('tenant_id', ctx.tenantId)
    .eq('entidad', 'requerimiento')
    .eq('accion', 'reprogramar')
    .gte('created_at', desdeIso);
  throwIf(error);
  return [...new Set((data ?? []).map((r) => (r as { entidad_id: string }).entidad_id))];
}
