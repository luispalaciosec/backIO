/** Registro del webhook de BackIO en el proyecto Basecamp de un cliente (uno por cliente activo). */
import { env } from '../../config/env';
import type { DbCtx } from '../db/client';
import { getCliente, updateClienteConfig } from '../db/clientes';
import { audit } from '../db/audit';
import { BasecampClient } from './client';

export function webhookUrl(): string {
  const base = process.env.BACKEND_PUBLIC_URL ?? env().BASECAMP_REDIRECT_URI?.replace(/\/api\/basecamp\/oauth\/callback$/, '');
  if (!base) throw new Error('BACKEND_PUBLIC_URL no configurada');
  const secret = env().BASECAMP_WEBHOOK_SECRET;
  return secret ? `${base}/api/webhooks/basecamp/${secret}` : `${base}/api/webhooks/basecamp`;
}

export async function registrarWebhookCliente(ctx: DbCtx, clienteId: string): Promise<{ webhook_id: number; payload_url: string }> {
  const cliente = await getCliente(ctx, clienteId);
  if (!cliente?.basecamp_project_id) throw new Error('Cliente sin basecamp_project_id');
  const bc = await BasecampClient.forTenant(ctx.tenantId);
  const url = webhookUrl();
  const existente = (cliente.config as { basecamp_webhook_id?: number }).basecamp_webhook_id;
  if (existente) return { webhook_id: existente, payload_url: url };
  const wh = await bc.registerWebhook(cliente.basecamp_project_id, url);
  await updateClienteConfig(ctx, clienteId, { config: { ...cliente.config, basecamp_webhook_id: wh.id, basecamp_webhook_url: url } });
  await audit(ctx, { accion: 'basecamp_registrar_webhook', entidad: 'cliente', entidad_id: clienteId, detalle: { webhook_id: wh.id, project: cliente.basecamp_project_id } });
  return { webhook_id: wh.id, payload_url: url };
}
