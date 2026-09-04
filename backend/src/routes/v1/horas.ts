import { Hono } from 'hono';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import { sincronizarHoras, resumenHoras } from '../../lib/horas';

export const horas = new Hono();

horas.get('/resumen', requireScope('read:backlog'), async (c) => {
  const dias = Number(c.req.query('dias') ?? 30);
  const desde = new Date(Date.now() - (Number.isFinite(dias) ? dias : 30) * 86_400_000).toISOString();
  return c.json(await resumenHoras(ctxOf(c), desde));
});
horas.post('/sincronizar', requireScope('write:requerimientos'), async (c) => {
  try { return c.json(await sincronizarHoras(ctxOf(c), { dias: Number(c.req.query('dias') ?? 45), clienteId: c.req.query('cliente') || undefined })); }
  catch (err) { return c.json({ error: err instanceof Error ? err.message : String(err) }, 422); }
});
