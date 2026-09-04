/** Jobs programados. Protegidos con CRON_SECRET (Vercel Cron / GitHub Actions). */
import { Hono } from 'hono';
import { serviceClient, throwIf } from '../lib/db';
import { reconcileTenant } from '../lib/basecamp/reconcile';
import { recalcularSenales } from '../lib/rituals/service';
import { procesarPendientes } from '../lib/notificaciones';

export const cron = new Hono();

cron.use('*', async (c, next) => {
  const secret = process.env.CRON_SECRET;
  if (secret && c.req.header('authorization') !== `Bearer ${secret}`) return c.text('unauthorized', 401);
  await next();
});

async function tenants(): Promise<string[]> {
  const { data, error } = await serviceClient().from('tenants').select('id').eq('activo', true);
  throwIf(error);
  return (data ?? []).map((t) => (t as { id: string }).id);
}

/** Cada 30 min: reconciliación Basecamp. */
cron.post('/basecamp/reconciliar', async (c) => {
  const out: Record<string, unknown> = {};
  for (const t of await tenants()) {
    try {
      out[t] = await reconcileTenant({ db: serviceClient(), tenantId: t, usuarioId: null, origen: 'cron' });
    } catch (err) {
      out[t] = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  return c.json(out);
});

/** Cada minuto: reintento de notificaciones pendientes. */
cron.post('/notificaciones', async (c) => c.json(await procesarPendientes()));

/** Domingo 18:00: señales del weekly. */
cron.post('/senales', async (c) => {
  const out: Record<string, number> = {};
  for (const t of await tenants()) {
    out[t] = (await recalcularSenales({ db: serviceClient(), tenantId: t, usuarioId: null, origen: 'cron' })).length;
  }
  return c.json(out);
});
