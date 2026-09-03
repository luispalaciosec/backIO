import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { env } from './config/env';
import { DbError } from './lib/db';
import { v1 } from './routes/v1';
import { portal } from './routes/portal';
import { basecampWebhook } from './routes/webhooks/basecamp';
import { prometioWebhook } from './routes/webhooks/prometio';
import { cron } from './routes/cron';

export function createApp(): Hono {
  const app = new Hono();
  app.use('*', secureHeaders());
  if (env().NODE_ENV !== 'test') app.use('*', logger());
  app.use('/api/*', cors({ origin: [env().FRONTEND_URL], allowHeaders: ['Authorization', 'Content-Type', 'X-Portal-Pin'], allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] }));

  app.get('/health', (c) => c.json({ ok: true, servicio: 'backio-backend', ts: new Date().toISOString() }));
  app.get('/robots.txt', (c) => c.text('User-agent: *\nDisallow: /api/portal/\n'));

  app.route('/api/v1', v1);
  app.route('/api/portal', portal);
  app.route('/api/webhooks/basecamp', basecampWebhook);
  app.route('/api/v1/webhooks/prometio', prometioWebhook);
  app.route('/api/cron', cron);

  app.notFound((c) => c.json({ error: 'Ruta no encontrada' }, 404));
  app.onError((err, c) => {
    if (err instanceof DbError) return c.json({ error: err.message, detalle: env().NODE_ENV === 'production' ? undefined : err.detalle }, err.status as 400);
    console.error(err);
    return c.json({ error: env().NODE_ENV === 'production' ? 'Error interno' : err.message }, 500);
  });
  return app;
}
