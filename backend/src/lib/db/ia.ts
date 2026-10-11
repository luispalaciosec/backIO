/**
 * Consultas de la capa de IA (lib/ia/): caché y registro de generaciones, y datos del daily narrado.
 */
import { type DbCtx, type FilaInsert, serviceClient, throwIf } from './client';

/** Última generación del tenant con el mismo tipo y hash de payload. El error se ignora (sin caché). */
export async function ultimaGeneracionIa(ctx: DbCtx, tipo: string, hash: string): Promise<{ texto: string; created_at: string } | null> {
  const { data } = await serviceClient()
    .from('ia_generaciones')
    .select('texto, created_at')
    .eq('tenant_id', ctx.tenantId)
    .eq('tipo', tipo)
    .eq('payload_hash', hash)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as { texto: string; created_at: string } | null;
}

export async function insertarGeneracionIa(fila: FilaInsert<'ia_generaciones'>): Promise<void> {
  const { error } = await serviceClient().from('ia_generaciones').insert(fila);
  throwIf(error);
}

/** Reprocesos abiertos desde `desdeIso` sobre los requerimientos dados (tope de 1000 ids). El error se ignora. */
export async function listReprocesosDelDia(ctx: DbCtx, desdeIso: string, requerimientoIds: string[]) {
  const { data } = await ctx.db
    .from('reprocesos')
    .select('id')
    .eq('tenant_id', ctx.tenantId)
    .gte('abierto_at', desdeIso)
    .in('requerimiento_id', requerimientoIds.slice(0, 1000));
  return data ?? [];
}
