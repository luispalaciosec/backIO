import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import { listMesas, upsertMesa, updateMesa, getMesa, audit, slugify } from '../../lib/db';
import { detectarBoardsMesa } from '../../lib/mcp/publish';

export const mesas = new Hono();

mesas.get('/', requireScope('read:proyectos'), async (c) => c.json({ items: await listMesas(ctxOf(c)) }));

const schema = z.object({
  nombre: z.string().min(2),
  basecamp_project_id: z.number().int().nullable().optional(),
  basecamp_board_daily_id: z.number().int().nullable().optional(),
  basecamp_board_weekly_id: z.number().int().nullable().optional(),
  lider_id: z.string().uuid().nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  activa: z.boolean().optional(),
});

mesas.post('/', requireScope('admin'), zValidator('json', schema), async (c) => {
  const ctx = ctxOf(c);
  const b = c.req.valid('json');
  const m = await upsertMesa(ctx, { ...b, slug: slugify(b.nombre) });
  await audit(ctx, { accion: 'crear_mesa', entidad: 'mesa', entidad_id: m.id });
  return c.json(m, 201);
});

mesas.patch('/:id', requireScope('admin'), zValidator('json', schema.partial()), async (c) => {
  const ctx = ctxOf(c);
  const m = await updateMesa(ctx, c.req.param('id'), c.req.valid('json'));
  await audit(ctx, { accion: 'actualizar_mesa', entidad: 'mesa', entidad_id: m.id, detalle: c.req.valid('json') });
  return c.json(m);
});

/** Lee el dock del proyecto Basecamp de la mesa y guarda los boards Daily y Weekly. */
mesas.post('/:id/basecamp/detectar-boards', requireScope('admin'), async (c) => {
  const ctx = ctxOf(c);
  const mesa = await getMesa(ctx, c.req.param('id'));
  if (!mesa) return c.json({ error: 'Mesa no encontrada' }, 404);
  try {
    const r = await detectarBoardsMesa(ctx, mesa);
    if (r.daily || r.weekly) await updateMesa(ctx, mesa.id, { basecamp_board_daily_id: r.daily ?? mesa.basecamp_board_daily_id, basecamp_board_weekly_id: r.weekly ?? mesa.basecamp_board_weekly_id });
    await audit(ctx, { accion: 'mesa_detectar_boards', entidad: 'mesa', entidad_id: mesa.id, detalle: r });
    return c.json(r);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 422);
  }
});
