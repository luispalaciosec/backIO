/** Recurrencias mensuales de fees (D2) y el proyecto generado por periodo. */
import type { Recurrencia } from '@backio/shared';
import { type DbCtx, type FilaInsert, type FilaUpdate, throwIf } from './client';

export async function listRecurrencias(ctx: DbCtx): Promise<Recurrencia[]> {
  const { data, error } = await ctx.db
    .from('recurrencias')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .order('created_at', { ascending: false });
  throwIf(error);
  return (data ?? []) as Recurrencia[];
}
export async function getRecurrencia(ctx: DbCtx, id: string): Promise<Recurrencia | null> {
  const { data, error } = await ctx.db.from('recurrencias').select('*').eq('tenant_id', ctx.tenantId).eq('id', id).maybeSingle();
  throwIf(error);
  return (data as Recurrencia) ?? null;
}

/** Una recurrencia por (tenant, cliente, plantilla): inserta o reemplaza. */
export async function upsertRecurrenciaFila(ctx: DbCtx, fila: FilaInsert<'recurrencias'>): Promise<Recurrencia> {
  const { data, error } = await ctx.db
    .from('recurrencias')
    .upsert(fila, { onConflict: 'tenant_id,cliente_id,plantilla_id' })
    .select()
    .single();
  throwIf(error);
  return data as Recurrencia;
}

export async function updateRecurrenciaFila(ctx: DbCtx, id: string, patch: FilaUpdate<'recurrencias'>): Promise<Recurrencia> {
  const { data, error } = await ctx.db
    .from('recurrencias')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('tenant_id', ctx.tenantId)
    .eq('id', id)
    .select()
    .single();
  throwIf(error);
  return data as Recurrencia;
}

/** Proyecto vivo ya generado para una recurrencia y periodo. Si la consulta falla devuelve null. */
export async function getProyectoDePeriodo(
  ctx: DbCtx,
  recurrenciaId: string,
  periodo: string,
): Promise<{ id: string; nombre: string } | null> {
  const { data: existente } = await ctx.db
    .from('proyectos')
    .select('id, nombre')
    .eq('tenant_id', ctx.tenantId)
    .eq('recurrencia_id', recurrenciaId)
    .eq('periodo', periodo)
    .is('deleted_at', null)
    .maybeSingle();
  return (existente as { id: string; nombre: string } | null) ?? null;
}

/** Registra el último periodo generado y su proyecto. */
export async function marcarPeriodoGenerado(ctx: DbCtx, id: string, periodo: string, proyectoId: string): Promise<void> {
  const { error } = await ctx.db
    .from('recurrencias')
    .update({ ultimo_mes_generado: periodo, ultimo_proyecto_id: proyectoId, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId);
  throwIf(error);
}
