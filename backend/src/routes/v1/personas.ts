import { Hono } from 'hono';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import { esColaborador } from '../../lib/auth/roles';
import { resumenPersonas, type Periodo } from '../../lib/personas';

export const personas = new Hono();
/**
 * Rendimiento por persona. Gestión ve a todo el equipo; un colaborador (por la UI o por un agente OAuth) solo su
 * propia fila y sin correo: antes veía el puntaje, las horas y el correo de todos (auditoría 10/10, S3).
 */
personas.get('/', requireScope('read:capacidad'), async (c) => {
  const p = (c.req.query('periodo') ?? 'semana') as Periodo;
  const ctx = ctxOf(c);
  const r = await resumenPersonas(ctx, ['dia', 'semana', 'mes'].includes(p) ? p : 'semana');
  if (!esColaborador(c.get('auth'))) return c.json(r);
  return c.json({ ...r, personas: r.personas.filter((x) => x.usuario_id === ctx.usuarioId).map(({ email: _e, ...resto }) => resto) });
});
