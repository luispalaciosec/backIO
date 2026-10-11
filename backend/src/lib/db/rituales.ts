/**
 * Consultas de la orquestación de rituales (lib/rituals/service.ts).
 */
import type { SignalThresholds } from '../rituals/signals';
import { type DbCtx, throwIf } from './client';

/** Umbrales del motor de señales configurados en el tenant (`config.signal_thresholds`). */
export async function getUmbralesSenales(ctx: DbCtx): Promise<Partial<SignalThresholds>> {
  const { data, error } = await ctx.db.from('tenants').select('config').eq('id', ctx.tenantId).single();
  throwIf(error);
  return (data as { config: { signal_thresholds?: Partial<SignalThresholds> } }).config.signal_thresholds ?? {};
}

/** Completados desde `desdeIso` (cliente y fecha). El error se ignora (cuenta como vacío). */
export async function listCompletadosRecientes(ctx: DbCtx, desdeIso: string) {
  const { data } = await ctx.db
    .from('requerimientos')
    .select('cliente_id, completado_at')
    .eq('tenant_id', ctx.tenantId)
    .eq('estado_operativo', 'completado')
    .gte('completado_at', desdeIso);
  return data ?? [];
}
