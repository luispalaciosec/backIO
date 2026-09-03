import { serve } from '@hono/node-server';
import { env } from './config/env';
import { createApp } from './app';
import { startScheduler } from './lib/scheduler';

const app = createApp();
const port = Number(process.env.PORT) || env().BACKEND_PORT;
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => {
  console.log(`BackIO backend escuchando en http://0.0.0.0:${port}`);
  startScheduler();
});
