/** «Mi Google Calendar»: cada persona conecta su calendario para que sus reuniones cuenten (docs/23). */
import { Hono } from 'hono';
import { ctxOf } from '../../lib/auth/middleware';
import { audit } from '../../lib/db';
import { borrarGoogle, conexionGoogle, leerTokensGoogle } from '../../lib/db/google';
import { usuarioParaBasecamp } from '../../lib/db/usuarios';
import { estadoGoogle, googleConfigurado, urlAutorizacionGoogle } from '../../lib/google/oauth';

export const google = new Hono();

google.get('/mi-cuenta', async (c) => {
  const ctx = ctxOf(c);
  if (!ctx.usuarioId) return c.json({ error: 'Solo para personas (no API keys)' }, 403);
  const con = await conexionGoogle(ctx.usuarioId);
  return c.json({ configurado: googleConfigurado(), conectado: !!con, email: con?.email ?? null, conectado_at: con?.conectado_at ?? null });
});

google.get('/mi-cuenta/url', async (c) => {
  const ctx = ctxOf(c);
  const a = c.get('auth');
  if (!ctx.usuarioId || a.tipo !== 'usuario' || a.perfil === 'oauth') return c.json({ error: 'Conéctalo desde BackIO con tu sesión' }, 403);
  if (!googleConfigurado()) return c.json({ error: 'Google Calendar todavía no está configurado en BackIO' }, 503);
  const u = await usuarioParaBasecamp(ctx.tenantId, ctx.usuarioId);
  return c.json({ url: urlAutorizacionGoogle(estadoGoogle(ctx.tenantId, ctx.usuarioId), u?.email) });
});

google.delete('/mi-cuenta', async (c) => {
  const ctx = ctxOf(c);
  if (!ctx.usuarioId) return c.json({ error: 'Solo para personas (no API keys)' }, 403);
  const t = await leerTokensGoogle(ctx.usuarioId);
  // También se retira el permiso en Google; si Google no responde, la conexión igual se borra de BackIO.
  if (t)
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t.refresh_token)}`, { method: 'POST' }).catch(
      () => undefined,
    );
  await borrarGoogle(ctx.usuarioId);
  await audit(ctx, { accion: 'google_desconectado', entidad: 'usuario', entidad_id: ctx.usuarioId, detalle: { motivo: 'la persona' } });
  return c.body(null, 204);
});
