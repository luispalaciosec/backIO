import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import { detectarHuerfanos, listHuerfanos, adoptarHuerfano, ignorarHuerfano } from '../../lib/basecamp/huerfanos';

export const huerfanos = new Hono();

huerfanos.get('/', requireScope('read:backlog'), async (c) => c.json({ items: await listHuerfanos(ctxOf(c), c.req.query('todos') !== '1') }));
huerfanos.post('/detectar', requireScope('write:requerimientos'), async (c) => {
  try { return c.json(await detectarHuerfanos(ctxOf(c))); } catch (err) { return c.json({ error: err instanceof Error ? err.message : String(err) }, 422); }
});
huerfanos.post('/:id/adoptar', requireScope('write:requerimientos'), zValidator('json', z.object({ proyecto_id: z.string().uuid().nullable().optional() })), async (c) => {
  try { return c.json(await adoptarHuerfano(ctxOf(c), c.req.param('id'), c.req.valid('json').proyecto_id ?? null)); } catch (err) { return c.json({ error: err instanceof Error ? err.message : String(err) }, 422); }
});
huerfanos.post('/:id/ignorar', requireScope('write:requerimientos'), async (c) => { await ignorarHuerfano(ctxOf(c), c.req.param('id')); return c.body(null, 204); });
