/**
 * Consultas de la orquestación de rituales (lib/rituals/service.ts).
 */
import type { SignalThresholds } from '../rituals/signals';
import { type DbCtx, throwIf } from './client';
import { paginar } from './paginar';

/** Umbrales del motor de señales configurados en el tenant (`config.signal_thresholds`). */
export async function getUmbralesSenales(ctx: DbCtx): Promise<Partial<SignalThresholds>> {
  const { data, error } = await ctx.db.from('tenants').select('config').eq('id', ctx.tenantId).single();
  throwIf(error);
  return (data as { config: { signal_thresholds?: Partial<SignalThresholds> } }).config.signal_thresholds ?? {};
}

/**
 * Completados desde `desdeIso` (cliente y fecha), paginado. Antes un error devolvía [] y las señales tomaban a todos los
 * clientes como «sin entregas» (alertas falsas): ahora el error se lanza.
 */
export async function listCompletadosRecientes(ctx: DbCtx, desdeIso: string) {
  return paginar<{ cliente_id: string; completado_at: string | null }>((a, b) =>
    ctx.db
      .from('requerimientos')
      .select('cliente_id, completado_at')
      .eq('tenant_id', ctx.tenantId)
      .eq('estado_operativo', 'completado')
      .gte('completado_at', desdeIso)
      .order('id')
      .range(a, b),
  );
}
