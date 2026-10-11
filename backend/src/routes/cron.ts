/**
 * Disparadores externos de los jobs (Vercel Cron, GitHub Actions) cuando no corre el scheduler interno. Protegidos
 * con CRON_SECRET. Corren el mismo job de lib/jobs.ts que el scheduler, en una ventana «manual» propia.
 */
import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { ejecutarJob, jobPorNombre, momentoLocal } from '../lib/jobs';

export const cron = new Hono();

cron.use('*', async (c, next) => {
  // Fail-closed: sin CRON_SECRET en producción nadie puede disparar jobs (antes quedaban públicos).
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV === 'production' ? c.text('unauthorized', 401) : next();
  const dado = Buffer.from((c.req.header('authorization') ?? '').replace(/^Bearer /, ''));
  const esperado = Buffer.from(secret);
  if (dado.length !== esperado.length || !timingSafeEqual(dado, esperado)) return c.text('unauthorized', 401);
  await next();
});

// Rutas históricas → nombre del job.
const RUTAS: Record<string, string> = {
  '/basecamp/reconciliar': 'reconcile',
  '/basecamp/estructura': 'estructura',
  '/notificaciones': 'notificaciones',
  '/senales': 'senales',
  '/recurrencias': 'recurrencias',
  '/horas': 'horas',
};

for (const [ruta, nombre] of Object.entries(RUTAS)) {
  cron.post(ruta, async (c) => {
    const job = jobPorNombre(nombre)!;
    const r = await ejecutarJob(job, momentoLocal(), { manual: true });
    return c.json(r?.resultado ?? { omitido: 'no aplica ahora' });
  });
}
