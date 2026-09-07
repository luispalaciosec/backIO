import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { env, frontendOrigins } from './config/env';
import { DbError } from './lib/db';
import { v1 } from './routes/v1';
import { portal } from './routes/portal';
import { basecampWebhook } from './routes/webhooks/basecamp';
import { prometioWebhook } from './routes/webhooks/prometio';
import { authPublico } from './routes/auth_publico';
import { cron } from './routes/cron';
import { basecampOAuth } from './routes/basecamp';
import { mcp } from './routes/mcp';
import { oauth, wellKnown } from './routes/oauth';
import { openapi } from './routes/openapi';

export function createApp(): Hono {
  const app = new Hono();
  app.use('*', secureHeaders());
  if (env().NODE_ENV !== 'test') app.use('*', logger());
  app.use('/.well-known/*', cors({ origin: '*' }));
  app.use('/oauth/*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type'], allowMethods: ['GET', 'POST', 'OPTIONS'] }));
  app.use('/mcp', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type', 'Mcp-Session-Id', 'Mcp-Protocol-Version'], allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'], exposeHeaders: ['Mcp-Session-Id'] }));
  app.use('/api/*', cors({ origin: frontendOrigins(), allowHeaders: ['Authorization', 'Content-Type', 'X-Portal-Pin'], allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] }));

  app.get('/health', (c) => c.json({ ok: true, servicio: 'backio-backend', ts: new Date().toISOString() }));
  app.get('/robots.txt', (c) => c.text('User-agent: *\nDisallow: /api/portal/\n'));

  // Webhooks públicos ANTES de /api/v1: el router v1 exige auth en '*' y se tragaba estas rutas.
  app.route('/api/v1/webhooks/prometio', prometioWebhook);
  app.route('/api/v1/auth', authPublico); // público: recuperación de contraseña (antes del router con auth)
  app.route('/api/v1', v1);
  app.route('/api/portal', portal);
  app.route('/api/webhooks/basecamp', basecampWebhook);
  app.route('/api/cron', cron);
  app.route('/api/basecamp', basecampOAuth);
  app.route('/mcp', mcp);
  app.route('/.well-known', wellKnown);
  app.route('/oauth', oauth);
  app.route('/api/openapi.json', openapi);

  app.notFound((c) => c.json({ error: 'Ruta no encontrada' }, 404));
  app.onError((err, c) => {
    if (err instanceof DbError) {
      // Siempre al log (con detalle) para poder diagnosticar en Railway; al cliente solo el mensaje.
      if (err.status >= 500) console.error(`[${c.req.method} ${c.req.path}] ${err.message}`, err.detalle ?? '');
      return c.json({ error: err.message, detalle: env().NODE_ENV === 'production' ? undefined : err.detalle }, err.status as 400);
    }
    console.error(`[${c.req.method} ${c.req.path}]`, err);
    return c.json({ error: env().NODE_ENV === 'production' ? 'Error interno' : err.message }, 500);
  });
  return app;
}
