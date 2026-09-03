import { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';
import { serviceClient } from '../../lib/db';
import { extractSafePayload, applyBasecampUpdate } from '../../lib/basecamp/sync';

export const basecampWebhook = new Hono();

function verify(raw: string, sig: string | undefined): boolean {
  const secret = env().BASECAMP_WEBHOOK_SECRET;
  if (!secret) return env().NODE_ENV !== 'production';
  if (!sig) return false;
  const esperado = createHmac('sha256', secret).update(raw).digest('hex');
  return sig.length === esperado.length && timingSafeEqual(Buffer.from(sig), Buffer.from(esperado));
}

basecampWebhook.post('/', async (c) => {
  const raw = await c.req.text();
  if (!verify(raw, c.req.header('x-backio-signature'))) return c.text('unauthorized', 401);

  let evento: unknown;
  try { evento = JSON.parse(raw); } catch { return c.text('bad json', 400); }

  // EXTRACCIÓN ESTRICTA (docs/02 · Defensa 1). El JSON crudo no se guarda ni se loguea.
  const safe = extractSafePayload(evento);
  if (!safe) return c.text('ok');

  const ctx = { db: serviceClient(), tenantId: '', usuarioId: null, origen: 'webhook:basecamp' as const };
  const r = await applyBasecampUpdate(ctx, safe);
  return c.json(r);
});
