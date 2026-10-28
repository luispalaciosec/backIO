/**
 * Consultas del dashboard (lib/dashboard.ts) y de personas (lib/personas.ts) sobre la vista de métricas.
 */
import type { RequerimientoMetricas } from '@backio/shared';
import { type DbCtx } from './client';
import { paginar } from './paginar';

/** Completados desde `desdeIso`, opcionalmente acotados al alcance de una mesa (mesa sin alcance: ninguno). */
export async function listCompletadosDesde(
  ctx: DbCtx,
  desdeIso: string,
  mesa?: { clienteIds: string[]; proyectoIds: string[] },
): Promise<RequerimientoMetricas[]> {
  const partes: string[] = [];
  if (mesa) {
    if (mesa.clienteIds.length) partes.push(`cliente_id.in.(${mesa.clienteIds.join(',')})`);
    if (mesa.proyectoIds.length) partes.push(`proyecto_id.in.(${mesa.proyectoIds.join(',')})`);
    if (!partes.length) return [];
  }
  // Paginado: 56 días de completados ya rozan las 1000 filas (934 el 28/10/2026).
  const filas = await paginar<RequerimientoMetricas>((a, b) => {
    let q = ctx.db
      .from('v_requerimientos_metricas')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .eq('estado_operativo', 'completado')
      .gte('completado_at', desdeIso);
    if (partes.length) q = q.or(partes.join(','));
    return q.order('id').range(a, b);
  });
  return filas.map((r) => ({ ...r, peso: Number(r.peso) }));
}

/** Huérfanos de Basecamp sin resolver (solo el conteo; el error se ignora). */
export async function contarHuerfanosPendientes(ctx: DbCtx): Promise<number | null> {
  const { count } = await ctx.db
    .from('basecamp_huerfanos')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', ctx.tenantId)
    .is('resuelto_at', null);
  return count;
}

/** Horas del timesheet desde `desde` (fecha local). */
export async function listHorasDesde(ctx: DbCtx, desde: string) {
  return paginar<{ usuario_id: string | null; fecha: string; horas: number }>((a, b) =>
    ctx.db.from('horas').select('usuario_id, fecha, horas').eq('tenant_id', ctx.tenantId).gte('fecha', desde).order('id').range(a, b),
  );
}
