import { Hono } from 'hono';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import { esColaborador } from '../../lib/auth/roles';
import { actividadDelDia } from '../../lib/actividad';
import { hoyLocal } from '@backio/shared';

/** Día a día: línea de tiempo por persona. Roles de gestión; un colaborador solo ve lo suyo. */
export const actividad = new Hono();
actividad.get('/', requireScope('read:backlog'), async (c) => {
  const ctx = ctxOf(c);
  const a = c.get('auth');
  const f = c.req.query('fecha');
  const fecha = f && /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : hoyLocal();
  const soloYo = esColaborador(a);
  return c.json(await actividadDelDia(ctx, fecha, soloYo ? ctx.usuarioId : c.req.query('usuario') || null));
});
