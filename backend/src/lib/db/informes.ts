/**
 * Consultas de los informes: informe por canal (lib/informe_canal.ts) e informe ejecutivo mensual (lib/ia/informe.ts).
 */
import type { RequerimientoMetricas } from '@backio/shared';
import { type DbCtx, throwIf } from './client';
import { paginar } from './paginar';

// ---------------------------------------------------------------- informe por canal

export async function listClientesCanal(ctx: DbCtx, clienteIds: string[]) {
  const { data, error } = await ctx.db
    .from('clientes')
    .select('id, nombre, color_primario, config')
    .eq('tenant_id', ctx.tenantId)
    .in('id', clienteIds);
  throwIf(error);
  return data ?? [];
}

/** Requerimientos vivos y no cancelados de los clientes del canal (todas las páginas). */
export async function listRequerimientosCanal<T>(ctx: DbCtx, clienteIds: string[]): Promise<T[]> {
  return paginar<T>((from, to) =>
    ctx.db
      .from('requerimientos')
      .select('cliente_id, piezas, estado_operativo, estado_aprobacion, prioridad, fecha_pedido, created_at, completado_at')
      .eq('tenant_id', ctx.tenantId)
      .in('cliente_id', clienteIds)
      .is('deleted_at', null)
      .neq('estado_operativo', 'cancelado')
      .order('id')
      .range(from, to),
  );
}

/** Clientes activos con su config (para armar grupos). El error se ignora (sin grupos). */
export async function listClientesActivosConfig(ctx: DbCtx) {
  const { data } = await ctx.db.from('clientes').select('id, nombre, config').eq('tenant_id', ctx.tenantId).eq('activo', true);
  return data ?? [];
}

/** Config del tenant (presets en `config.informes_canal`). El error se ignora (sin presets). */
export async function getConfigTenantInformes(ctx: DbCtx) {
  const { data } = await ctx.db.from('tenants').select('config').eq('id', ctx.tenantId).single();
  return data;
}

// ---------------------------------------------------------------- informe mensual

/** Completados entre `desdeIso` y `hastaIso` en el alcance de la mesa (alcance vacío: todo el tenant). */
export async function listCompletadosEntre(
  ctx: DbCtx,
  desdeIso: string,
  hastaIso: string,
  alcance: { clienteIds: string[]; proyectoIds: string[] },
): Promise<RequerimientoMetricas[]> {
  let q = ctx.db
    .from('v_requerimientos_metricas')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .eq('estado_operativo', 'completado')
    .gte('completado_at', desdeIso)
    .lte('completado_at', hastaIso);
  const partes: string[] = [];
  if (alcance.clienteIds.length) partes.push(`cliente_id.in.(${alcance.clienteIds.join(',')})`);
  if (alcance.proyectoIds.length) partes.push(`proyecto_id.in.(${alcance.proyectoIds.join(',')})`);
  if (partes.length) q = q.or(partes.join(','));
  const { data, error } = await q;
  throwIf(error);
  return (data ?? []) as RequerimientoMetricas[];
}

/** Señales de las semanas que empiezan dentro del rango. El error se ignora (cuenta como vacío). */
export async function listSenalesEntre(ctx: DbCtx, desde: string, hasta: string) {
  const { data } = await ctx.db
    .from('senales')
    .select('tipo, severidad, semanas!inner(fecha_inicio)')
    .eq('tenant_id', ctx.tenantId)
    .gte('semanas.fecha_inicio', desde)
    .lte('semanas.fecha_inicio', hasta);
  return data ?? [];
}

/** Valor cotizado de los proyectos activos (ni completados ni cancelados). */
export async function listCotizadoProyectosActivos(ctx: DbCtx) {
  const { data, error } = await ctx.db
    .from('proyectos')
    .select('cliente_id, valor_cotizado')
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .not('estado', 'in', '(completado,cancelado)');
  throwIf(error);
  return data ?? [];
}
