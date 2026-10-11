/**
 * Patrón preview + confirm (docs/07). Las tools de escritura generan un plan que expira en
 * 15 minutos y es de un solo uso. Ejecutar es una segunda llamada con el plan_id.
 */
import { randomBytes } from 'node:crypto';
import type { DbCtx } from '../db/client';
import { DbError } from '../db/client';
import { getAgentPlan, guardarResultadoAgentPlan, insertarAgentPlan, marcarAgentPlanEjecutado } from '../db/agent_plans';

export const PLAN_TTL_MS = 15 * 60_000;

export interface AgentPlan<P = unknown, R = unknown> {
  id: string;
  tenant_id: string;
  api_key_id: string | null;
  usuario_id: string | null;
  tool: string;
  parametros: P;
  plan: R;
  expira_at: string;
  ejecutado_at: string | null;
}

export async function guardarPlan<P, R>(ctx: DbCtx, tool: string, parametros: P, plan: R): Promise<{ plan_id: string; expira_en: string }> {
  const id = `plan_${randomBytes(6).toString('hex')}`;
  const expira = new Date(Date.now() + PLAN_TTL_MS).toISOString();
  await insertarAgentPlan(ctx, {
    id,
    tenant_id: ctx.tenantId,
    api_key_id: ctx.apiKeyId ?? null,
    usuario_id: ctx.usuarioId ?? null,
    tool,
    parametros,
    plan,
    expira_at: expira,
  });
  return { plan_id: id, expira_en: expira };
}

/** Lee un plan sin consumirlo (para verificar permisos antes de gastarlo). */
export async function verPlan(ctx: DbCtx, planId: string): Promise<AgentPlan | null> {
  const data = await getAgentPlan(ctx, planId);
  return (data as AgentPlan) ?? null;
}

export async function tomarPlan<P = unknown, R = unknown>(ctx: DbCtx, planId: string): Promise<AgentPlan<P, R>> {
  const data = await getAgentPlan(ctx, planId);
  const p = data as AgentPlan<P, R> | null;
  if (!p) throw new DbError('plan_id no existe o no pertenece a este tenant', 404);
  if (p.ejecutado_at) throw new DbError('Este plan ya fue ejecutado (un solo uso)', 409);
  if (new Date(p.expira_at).getTime() < Date.now()) throw new DbError('El plan expiró (15 minutos). Genera uno nuevo.', 410);
  // Marca atómica de ejecución: si dos confirmaciones compiten, solo una pasa.
  const marcado = await marcarAgentPlanEjecutado(ctx, planId);
  if (!marcado || marcado.length === 0) throw new DbError('Este plan ya fue ejecutado (un solo uso)', 409);
  return p;
}

export async function guardarResultado(ctx: DbCtx, planId: string, resultado: unknown): Promise<void> {
  await guardarResultadoAgentPlan(ctx, planId, resultado);
}
