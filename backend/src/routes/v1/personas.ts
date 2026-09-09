import { Hono } from 'hono';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import { resumenPersonas, type Periodo } from '../../lib/personas';

export const personas = new Hono();
personas.get('/', requireScope('read:capacidad'), async (c) => {
  const p = (c.req.query('periodo') ?? 'semana') as Periodo;
  return c.json(await resumenPersonas(ctxOf(c), ['dia', 'semana', 'mes'].includes(p) ? p : 'semana'));
});
