import { Hono } from 'hono';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import { buildState, authorizationUrl, getStatus, disconnect } from '../../lib/basecamp/oauth';
import { audit } from '../../lib/db';

export const basecamp = new Hono();

/** Solo admin: devuelve la URL de autorización; el navegador debe redirigir ahí. */
basecamp.get('/oauth/url', requireScope('admin'), async (c) => {
  const ctx = ctxOf(c);
  if (!ctx.usuarioId) return c.json({ error: 'Solo usuarios (no API keys) pueden conectar Basecamp' }, 403);
  try {
    return c.json({ url: authorizationUrl(buildState(ctx.tenantId, ctx.usuarioId)) });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'config incompleta' }, 500);
  }
});

basecamp.get('/status', requireScope('read:proyectos'), async (c) => c.json(await getStatus(ctxOf(c).tenantId)));

basecamp.post('/disconnect', requireScope('admin'), async (c) => {
  const ctx = ctxOf(c);
  await disconnect(ctx.tenantId);
  await audit(ctx, { accion: 'basecamp_desconectado', entidad: 'tenant', entidad_id: ctx.tenantId });
  return c.body(null, 204);
});
