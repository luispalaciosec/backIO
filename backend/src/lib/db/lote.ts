/**
 * Escrituras de varios pasos en una sola transacción de Postgres (migración 29, auditoría 10/10 B7 y B8).
 */
import type { Proyecto, Requerimiento } from '@backio/shared';
import { type DbCtx, DbError, throwIf } from './client';
import type { InsertProyecto } from './proyectos';
import type { InsertRequerimiento } from './requerimientos';

export type ProyectoDelLote = InsertProyecto & { clave: string };
export type RequerimientoDelLote = InsertRequerimiento & { proyecto_clave?: string };

/**
 * Crea proyectos y requerimientos juntos: si una fila falla, no queda nada (antes quedaban proyectos huérfanos con
 * portal token). Corre con el cliente de quien llama (RLS y triggers de visibilidad aplican). Un requerimiento puede
 * apuntar a un proyecto del mismo lote con `proyecto_clave`.
 */
export async function crearLote(
  ctx: DbCtx,
  proyectos: ProyectoDelLote[],
  requerimientos: RequerimientoDelLote[],
): Promise<{ proyectos: Record<string, Proyecto>; requerimientos: Requerimiento[] }> {
  for (const r of requerimientos)
    if (r.visible_cliente && !r.etiqueta_cliente)
      throw new DbError(`"${r.titulo_interno}": visible al cliente requiere etiqueta_cliente`, 422);
  const auditoria = { tenant_id: ctx.tenantId, created_by: ctx.usuarioId, updated_by: ctx.usuarioId };
  const { data, error } = await ctx.db.rpc('crear_lote', {
    p_proyectos: proyectos.map(({ clave, ...p }) => ({ ...p, ...auditoria, _clave: clave })),
    p_requerimientos: requerimientos.map(({ proyecto_clave, ...r }) => ({
      ...r,
      ...auditoria,
      ...(proyecto_clave ? { _proyecto_clave: proyecto_clave } : {}),
    })),
  });
  throwIf(error);
  return data as { proyectos: Record<string, Proyecto>; requerimientos: Requerimiento[] };
}
