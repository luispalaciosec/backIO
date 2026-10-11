/** Clientes cuyo proyecto de Basecamp lleva (o debe llevar) el webhook de BackIO. */
import type { DbCtx } from './client';

export interface ClienteWebhook {
  id: string;
  nombre: string;
  basecamp_project_id: number;
  config: Record<string, unknown>;
}

/** Clientes activos, vivos y con proyecto de Basecamp. Si la consulta falla devuelve []. */
export async function listClientesConWebhook(ctx: DbCtx): Promise<ClienteWebhook[]> {
  const { data } = await ctx.db
    .from('clientes')
    .select('id, nombre, basecamp_project_id, config')
    .eq('tenant_id', ctx.tenantId)
    .eq('activo', true)
    .is('deleted_at', null)
    .not('basecamp_project_id', 'is', null);
  return (data ?? []) as ClienteWebhook[];
}
