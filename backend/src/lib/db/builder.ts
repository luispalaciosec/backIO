/** Borradores de proyecto del Builder (`proyecto_borradores`). */
import type { DbCtx } from './client';

/**
 * Marca como convertido el borrador nacido de una cotización de PrometIO y devuelve su payload.
 * Si la consulta falla devuelve null.
 */
export async function convertirBorradorCotizacion(
  ctx: DbCtx,
  prometioCotizacionId: string,
  proyectoId: string,
): Promise<{ payload?: { valor?: number | null } } | null> {
  const { data: b } = await ctx.db
    .from('proyecto_borradores')
    .update({ estado: 'convertido', proyecto_id: proyectoId })
    .eq('tenant_id', ctx.tenantId)
    .eq('prometio_cotizacion_id', prometioCotizacionId)
    .select('payload')
    .maybeSingle();
  return b as { payload?: { valor?: number | null } } | null;
}
