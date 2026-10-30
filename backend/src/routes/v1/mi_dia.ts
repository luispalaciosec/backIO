import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '../../lib/validacion';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import { miDia } from '../../lib/mi_dia';
import { getAvisosMiDia, setAvisosMiDia } from '../../lib/db/usuarios';
import { audit } from '../../lib/db/audit';
import { listarMisNotificaciones, marcarLeidas } from '../../lib/db/notificaciones';
import { separarRuta } from '../../lib/notificaciones';

/** «Mi día» y la campana de avisos (docs/22): siempre de la persona que llama. */
export const miDiaRutas = new Hono();

miDiaRutas.get('/mi-dia', requireScope('read:backlog'), async (c) => {
  const ctx = ctxOf(c);
  if (!ctx.usuarioId) return c.json({ error: 'Solo para personas' }, 403);
  const [m, avisos] = await Promise.all([miDia(ctx, ctx.usuarioId), getAvisosMiDia(ctx, ctx.usuarioId)]);
  return c.json({ ...m, avisos_mi_dia: avisos });
});

/** Activa o desactiva el correo de «Mi día» (la campana lo sigue recibiendo). Solo la propia persona. */
miDiaRutas.put('/mi-dia/avisos', requireScope('read:backlog'), zValidator('json', z.object({ correo: z.boolean() })), async (c) => {
  const ctx = ctxOf(c);
  if (!ctx.usuarioId) return c.json({ error: 'Solo para personas' }, 403);
  const { correo } = c.req.valid('json');
  await setAvisosMiDia(ctx, ctx.usuarioId, correo);
  await audit(ctx, { accion: 'avisos_mi_dia', entidad: 'usuario', entidad_id: ctx.usuarioId, detalle: { correo } });
  return c.json({ avisos_mi_dia: correo });
});

/** Campana: avisos propios de los últimos 30 días, con su enlace aparte del texto. */
miDiaRutas.get('/notificaciones', requireScope('read:backlog'), async (c) => {
  const ctx = ctxOf(c);
  if (!ctx.usuarioId) return c.json({ items: [], no_leidas: 0 });
  const items = (await listarMisNotificaciones(ctx)).map((n) => {
    const { cuerpo, ruta } = separarRuta(n.cuerpo ?? '');
    return { ...n, cuerpo, ruta: ruta ?? null };
  });
  return c.json({ items, no_leidas: items.filter((n) => !n.leida_at).length });
});

miDiaRutas.post('/notificaciones/leidas', requireScope('read:backlog'), async (c) => {
  await marcarLeidas(ctxOf(c));
  return c.json({ ok: true });
});

miDiaRutas.post('/notificaciones/:id/leida', requireScope('read:backlog'), async (c) => {
  await marcarLeidas(ctxOf(c), c.req.param('id'));
  return c.json({ ok: true });
});
