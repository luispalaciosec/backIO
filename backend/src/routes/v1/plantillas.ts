import { Hono } from 'hono';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import { listPlantillas, getPlantillaArbol } from '../../lib/db';

export const plantillas = new Hono();

plantillas.get('/', requireScope('read:proyectos'), async (c) => {
  const items = await listPlantillas(ctxOf(c));
  return c.json({ items, total: items.length });
});

plantillas.get('/:id', requireScope('read:proyectos'), async (c) => {
  const p = await getPlantillaArbol(ctxOf(c), c.req.param('id'));
  return p ? c.json(p) : c.json({ error: 'No encontrado' }, 404);
});
