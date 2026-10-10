import { serve } from '@hono/node-server';
import { env } from './config/env';
import { createApp } from './app';
import { startScheduler } from './lib/scheduler';

// Red de seguridad: un rechazo o excepción suelta se registra en vez de terminar el proceso (Node 22 lo terminaría).
process.on('unhandledRejection', (razon) => console.error('[proceso] promesa rechazada sin manejar', razon instanceof Error ? razon.stack ?? razon.message : razon));
process.on('uncaughtException', (err) => console.error('[proceso] excepción sin capturar', err.stack ?? err.message));

const app = createApp();
const port = Number(process.env.PORT) || env().BACKEND_PORT;
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => {
  console.log(`BackIO backend escuchando en http://0.0.0.0:${port}`);
  startScheduler();
});
