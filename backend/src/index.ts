import { serve } from '@hono/node-server';
import { env } from './config/env';
import { createApp } from './app';

const app = createApp();
const port = env().BACKEND_PORT;
serve({ fetch: app.fetch, port }, () => {
  console.log(`BackIO backend escuchando en http://localhost:${port}`);
});
