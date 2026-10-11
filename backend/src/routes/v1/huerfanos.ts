import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '../../lib/validacion';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import { detectarHuerfanos, listHuerfanos, adoptarHuerfano, ignorarHuerfano } from '../../lib/basecamp/huerfanos';
import { audit } from '../../lib/db/audit';
import { entradasBasecampSinRevisar } from '../../lib/db/audit';
import { metricasPorIds } from '../../lib/db/requerimientos';

export const huerfanos = new Hono();

huerfanos.get('/', requireScope('read:backlog'), async (c) =>
  c.json({ items: await listHuerfanos(ctxOf(c), c.req.query('todos') !== '1') }),
);
huerfanos.post('/detectar', requireScope('write:requerimientos'), async (c) => {
  try {
    return c.json(await detectarHuerfanos(ctxOf(c)));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 422);
  }
});
huerfanos.post(
  '/:id/adoptar',
  requireScope('write:requerimientos'),
  zValidator('json', z.object({ proyecto_id: z.string().uuid().nullable().optional() })),
  async (c) => {
    try {
      return c.json(await adoptarHuerfano(ctxOf(c), c.req.param('id'), c.req.valid('json').proyecto_id ?? null));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 422);
    }
  },
);
/**
 * Bandeja «Entradas desde Basecamp»: requerimientos que entraron solos desde Basecamp (audit basecamp_entrada)
 * en los últimos N días y que ninguna ejecutiva marcó como revisados (audit revisar_entrada).
 */
huerfanos.get('/entradas', requireScope('read:backlog'), async (c) => {
  const ctx = ctxOf(c);
  const dias = Number(c.req.query('dias') ?? 14);
  const desde = new Date(Date.now() - (Number.isFinite(dias) ? dias : 14) * 86_400_000).toISOString();
  const entradas = await entradasBasecampSinRevisar(ctx, desde);
  if (!entradas.length) return c.json({ items: [] });
  const reqs = await metricasPorIds(
    ctx,
    entradas.map((e) => e.entidad_id),
  );
  const porId = new Map(reqs.map((r) => [r.id, r]));
  const items = entradas
    .filter((e) => porId.has(e.entidad_id))
    .map((e) => ({
      ...(porId.get(e.entidad_id) as object),
      entrada_at: e.created_at,
      lista: e.detalle.lista ?? null,
      creador: e.detalle.creador ?? null,
    }));
  return c.json({ items });
});
huerfanos.post('/entradas/:id/revisada', requireScope('write:requerimientos'), async (c) => {
  const ctx = ctxOf(c);
  await audit(ctx, { accion: 'revisar_entrada', entidad: 'requerimiento', entidad_id: c.req.param('id'), detalle: {} });
  return c.body(null, 204);
});
huerfanos.post('/:id/ignorar', requireScope('write:requerimientos'), async (c) => {
  await ignorarHuerfano(ctxOf(c), c.req.param('id'));
  return c.body(null, 204);
});
