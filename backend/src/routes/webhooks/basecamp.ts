/**
 * Webhook de Basecamp. Basecamp NO firma los payloads: la autenticidad se garantiza con un
 * token secreto en la URL registrada (/api/webhooks/basecamp/<token>) que solo Basecamp conoce.
 */
import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';
import { serviceClient } from '../../lib/db';
import { extractSafePayload, applyBasecampUpdate } from '../../lib/basecamp/sync';

export const basecampWebhook = new Hono();

function tokenValido(t: string | undefined): boolean {
  const secret = env().BASECAMP_WEBHOOK_SECRET;
  if (!secret) return env().NODE_ENV !== 'production';
  if (!t || t.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(t), Buffer.from(secret));
}

async function handle(raw: string) {
  let evento: unknown;
  try { evento = JSON.parse(raw); } catch { return { status: 400 as const, body: 'bad json' }; }
  // EXTRACCIÓN ESTRICTA (docs/02 · Defensa 1). El JSON crudo no se guarda ni se loguea.
  const safe = extractSafePayload(evento);
  if (!safe) return { status: 200 as const, body: 'ok' };
  const ctx = { db: serviceClient(), tenantId: '', usuarioId: null, origen: 'webhook:basecamp' as const };
  return { status: 200 as const, body: JSON.stringify(await applyBasecampUpdate(ctx, safe)) };
}

basecampWebhook.post('/:token', async (c) => {
  if (!tokenValido(c.req.param('token'))) return c.text('unauthorized', 401);
  const r = await handle(await c.req.text());
  return c.text(r.body, r.status);
});

// Compatibilidad: sin token solo en desarrollo.
basecampWebhook.post('/', async (c) => {
  if (!tokenValido(undefined)) return c.text('unauthorized', 401);
  const r = await handle(await c.req.text());
  return c.text(r.body, r.status);
});
