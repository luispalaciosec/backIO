/** Planes de las tools de escritura de agentes (preview + confirm, lib/mcp/plans). Con el cliente del contexto. */
import { throwIf, type DbCtx, type FilaInsert } from './client';

export async function insertarAgentPlan(ctx: DbCtx, fila: FilaInsert<'agent_plans'>): Promise<void> {
  const { error } = await ctx.db.from('agent_plans').insert(fila);
  throwIf(error);
}

/** Plan del tenant del contexto, o null. */
export async function getAgentPlan(ctx: DbCtx, planId: string) {
  const { data, error } = await ctx.db.from('agent_plans').select('*').eq('id', planId).eq('tenant_id', ctx.tenantId).maybeSingle();
  throwIf(error);
  return data;
}

/** Marca el plan como ejecutado solo si no lo estaba (update condicional). Devuelve las filas marcadas. */
export async function marcarAgentPlanEjecutado(ctx: DbCtx, planId: string): Promise<{ id: string }[] | null> {
  const { data, error } = await ctx.db
    .from('agent_plans')
    .update({ ejecutado_at: new Date().toISOString() })
    .eq('id', planId)
    .eq('tenant_id', ctx.tenantId)
    .is('ejecutado_at', null)
    .select('id');
  throwIf(error);
  return data;
}

export async function guardarResultadoAgentPlan(ctx: DbCtx, planId: string, resultado: unknown): Promise<void> {
  await ctx.db.from('agent_plans').update({ resultado }).eq('id', planId).eq('tenant_id', ctx.tenantId);
}
