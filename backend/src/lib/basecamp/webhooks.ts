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
  // Solo el id: la URL lleva el secreto del webhook y clientes.config era legible por todos los usuarios.
  const { basecamp_webhook_url: _u, ...restoConfig } = cliente.config as Record<string, unknown>;
  await updateClienteConfig(ctx, clienteId, { config: { ...restoConfig, basecamp_webhook_id: wh.id } });
  await audit(ctx, { accion: 'basecamp_registrar_webhook', entidad: 'cliente', entidad_id: clienteId, detalle: { webhook_id: wh.id, project: cliente.basecamp_project_id } });
  return { webhook_id: wh.id, payload_url: url };
}

/**
 * Rotación del secreto: reescribe la URL del webhook de cada cliente activo con la URL actual
 * (BASECAMP_WEBHOOK_SECRET vigente). Los que no tienen webhook se registran. Idempotente.
 */
export async function actualizarWebhooksTenant(ctx: DbCtx): Promise<{ actualizados: string[]; registrados: string[]; errores: { cliente: string; error: string }[] }> {
  const url = webhookUrl();
  const bc = await BasecampClient.forTenant(ctx.tenantId);
  const { data } = await ctx.db.from('clientes').select('id, nombre, basecamp_project_id, config').eq('tenant_id', ctx.tenantId).eq('activo', true).is('deleted_at', null).not('basecamp_project_id', 'is', null);
  const out = { actualizados: [] as string[], registrados: [] as string[], errores: [] as { cliente: string; error: string }[] };
  for (const c of (data ?? []) as { id: string; nombre: string; basecamp_project_id: number; config: Record<string, unknown> }[]) {
    try {
      const id = c.config?.basecamp_webhook_id as number | undefined;
      if (id) {
        const actual = await bc.getWebhookDeliveries(c.basecamp_project_id, id).catch(() => null);
        if (actual && actual.payload_url === url && actual.activo) continue;
        await bc.updateWebhook(c.basecamp_project_id, id, url);
        out.actualizados.push(c.nombre);
      } else {
        await registrarWebhookCliente(ctx, c.id);
        out.registrados.push(c.nombre);
      }
    } catch (err) { out.errores.push({ cliente: c.nombre, error: err instanceof Error ? err.message.slice(0, 120) : String(err) }); }
  }
  await audit(ctx, { accion: 'basecamp_actualizar_webhooks', entidad: 'tenant', entidad_id: ctx.tenantId, detalle: { actualizados: out.actualizados.length, registrados: out.registrados.length, errores: out.errores.length } });
  return out;
}

export async function diagnosticoWebhookCliente(ctx: DbCtx, clienteId: string) {
  const cliente = await getCliente(ctx, clienteId);
  if (!cliente?.basecamp_project_id) throw new Error('Cliente sin basecamp_project_id');
  const id = (cliente.config as { basecamp_webhook_id?: number }).basecamp_webhook_id;
  if (!id) throw new Error('Cliente sin webhook registrado');
  const bc = await BasecampClient.forTenant(ctx.tenantId);
  const d = await bc.getWebhookDeliveries(cliente.basecamp_project_id, id);
  // Se enmascara el token de la URL.
  return { webhook_id: id, activo: d.activo, payload_url: d.payload_url.replace(/(\/api\/webhooks\/basecamp\/)[^/]+$/, '$1***'), url_coincide: d.payload_url === webhookUrl(), entregas: d.entregas };
}
