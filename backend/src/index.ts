import { serve } from '@hono/node-server';
import { env } from './config/env';
import { createApp } from './app';
import { startScheduler } from './lib/scheduler';
import { log } from './lib/logger';
import { iniciarSentry } from './lib/sentry';

// Sentry (si hay SENTRY_DSN) antes de levantar el servidor y el scheduler.
iniciarSentry();

// Red de seguridad: un rechazo o excepción suelta se registra en vez de terminar el proceso (Node 22 lo terminaría).
process.on('unhandledRejection', (razon) => log.error('[proceso] promesa rechazada sin manejar', razon));
process.on('uncaughtException', (err) => log.error('[proceso] excepción sin capturar', err));

const app = createApp();
const port = Number(process.env.PORT) || env().BACKEND_PORT;
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => {
  log.info(`BackIO backend escuchando en http://0.0.0.0:${port}`);
  startScheduler();
});
