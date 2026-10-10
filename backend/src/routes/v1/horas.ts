import { Hono } from 'hono';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import { esColaborador } from '../../lib/auth/roles';
import { sincronizarHoras, resumenHoras } from '../../lib/horas';

export const horas = new Hono();

horas.get('/resumen', requireScope('read:backlog'), async (c) => {
  const dias = Number(c.req.query('dias') ?? 30);
  const desde = new Date(Date.now() - (Number.isFinite(dias) ? dias : 30) * 86_400_000).toISOString();
  const ctx = ctxOf(c);
  const r = await resumenHoras(ctx, desde);
  // Un colaborador ve las horas por tarea (las usa el backlog), pero de las horas por persona solo las suyas (S3).
  if (esColaborador(c.get('auth'))) return c.json({ ...r, por_usuario: ctx.usuarioId && r.por_usuario[ctx.usuarioId] !== undefined ? { [ctx.usuarioId]: r.por_usuario[ctx.usuarioId] } : {} });
  return c.json(r);
});
horas.post('/sincronizar', requireScope('write:requerimientos'), async (c) => {
  try { return c.json(await sincronizarHoras(ctxOf(c), { dias: Number(c.req.query('dias') ?? 45), clienteId: c.req.query('cliente') || undefined })); }
  catch (err) { return c.json({ error: err instanceof Error ? err.message : String(err) }, 422); }
});
