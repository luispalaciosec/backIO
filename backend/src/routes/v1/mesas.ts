import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import { listMesas, upsertMesa, updateMesa, audit, slugify } from '../../lib/db';

export const mesas = new Hono();

mesas.get('/', requireScope('read:proyectos'), async (c) => c.json({ items: await listMesas(ctxOf(c)) }));

const schema = z.object({
  nombre: z.string().min(2),
  basecamp_project_id: z.number().int().nullable().optional(),
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
