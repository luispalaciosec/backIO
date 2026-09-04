/**
 * Webhook de Basecamp. Basecamp NO firma los payloads: la autenticidad se garantiza con un
 * token secreto en la URL registrada (/api/webhooks/basecamp/<token>) que solo Basecamp conoce.
 */
import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';
import { serviceClient } from '../../lib/db';
import { extractSafePayload, extractSafeTodo, applyBasecampUpdate, type BasecampSyncPayload } from '../../lib/basecamp/sync';
import { findByBasecampTodo } from '../../lib/db/requerimientos';
import { audit } from '../../lib/db/audit';
import { BasecampClient } from '../../lib/basecamp/client';

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
  let safe: BasecampSyncPayload | null = extractSafePayload(evento);
  if (!safe) return { status: 200 as const, body: 'ok' };
  const kind = (evento as { kind?: string }).kind ?? '';
  const ctx = { db: serviceClient(), tenantId: '', usuarioId: null, origen: 'webhook:basecamp' as const };

  // Estado desconocido (p. ej. todo_changed): consultar el to-do vivo. Solo se extraen campos seguros.
  if (safe.completed === null) {
    const req = await findByBasecampTodo(ctx, safe.todo_id);
    if (req && safe.bucket_id) {
      try {
        const bc = await BasecampClient.forTenant(req.tenant_id);
        const vivo = extractSafeTodo(await bc.getTodoRaw(safe.bucket_id, safe.todo_id));
        if (vivo) safe = { ...vivo, completed: vivo.completed ?? false };
      } catch (err) {
        console.error('[webhook basecamp] no se pudo consultar el to-do vivo', err instanceof Error ? err.message : err);
      }
    }
  }

  const resultado = await applyBasecampUpdate(ctx, safe);
  if (resultado.requerimiento_id) {
    const { data } = await ctx.db.from('requerimientos').select('tenant_id').eq('id', resultado.requerimiento_id).single();
    const tenantId = (data as { tenant_id: string } | null)?.tenant_id;
    if (tenantId) await audit({ ...ctx, tenantId }, { accion: 'webhook_basecamp', entidad: 'requerimiento', entidad_id: resultado.requerimiento_id, detalle: { kind, todo_id: safe.todo_id, ...resultado } });
  }
  return { status: 200 as const, body: JSON.stringify(resultado) };
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
