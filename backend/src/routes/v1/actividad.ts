import { Hono } from 'hono';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import { actividadDelDia } from '../../lib/actividad';
import { fechaLocal } from '../../lib/rituals/daily';

/** Día a día: línea de tiempo por persona. Roles de gestión; un colaborador solo ve lo suyo. */
export const actividad = new Hono();
actividad.get('/', requireScope('read:backlog'), async (c) => {
  const ctx = ctxOf(c); const a = c.get('auth');
  const f = c.req.query('fecha'); const fecha = f && /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : fechaLocal();
  const soloYo = a.tipo === 'usuario' && a.rol === 'colaborador';
  return c.json(await actividadDelDia(ctx, fecha, soloYo ? ctx.usuarioId : c.req.query('usuario') || null));
});
