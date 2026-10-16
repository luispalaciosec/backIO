import { Hono } from 'hono';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import { buildState, authorizationUrl, getStatus, disconnect } from '../../lib/basecamp/oauth';
import { audit } from '../../lib/db';
import { borrarCredencialesPersona, conexionPersona } from '../../lib/db/credenciales';

export const basecamp = new Hono();

/** Solo admin: devuelve la URL de autorización; el navegador debe redirigir ahí. */
basecamp.get('/oauth/url', requireScope('admin'), async (c) => {
  const ctx = ctxOf(c);
  if (!ctx.usuarioId) return c.json({ error: 'Solo usuarios (no API keys) pueden conectar Basecamp' }, 403);
  try {
    return c.json({ url: authorizationUrl(buildState(ctx.tenantId, ctx.usuarioId)) });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'config incompleta' }, 500);
  }
});

// ---------------- Mi Basecamp: la cuenta de cada persona (migración 33). Cualquier usuario con sesión, para sí mismo.
/** ¿Conecté mi Basecamp? Nunca devuelve tokens. */
basecamp.get('/mi-cuenta', async (c) => {
  const ctx = ctxOf(c);
  if (!ctx.usuarioId) return c.json({ error: 'Solo para personas (no API keys)' }, 403);
  const conexion = await conexionPersona(ctx.usuarioId);
  return c.json({ conectado: !!conexion, conectado_at: conexion?.conectado_at ?? null, email: conexion?.email ?? null });
});

/** URL para autorizar mi cuenta de Basecamp. */
basecamp.get('/mi-cuenta/url', async (c) => {
  const ctx = ctxOf(c);
  const a = c.get('auth');
  if (!ctx.usuarioId || a.tipo !== 'usuario' || a.perfil === 'oauth') return c.json({ error: 'Conéctalo desde BackIO con tu sesión' }, 403);
  try {
    return c.json({ url: authorizationUrl(buildState(ctx.tenantId, ctx.usuarioId, 'persona')) });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'config incompleta' }, 500);
  }
});

basecamp.delete('/mi-cuenta', async (c) => {
  const ctx = ctxOf(c);
  if (!ctx.usuarioId) return c.json({ error: 'Solo para personas (no API keys)' }, 403);
  await borrarCredencialesPersona(ctx.usuarioId);
  await audit(ctx, { accion: 'basecamp_persona_desconectada', entidad: 'usuario', entidad_id: ctx.usuarioId });
  return c.body(null, 204);
});

basecamp.get('/status', requireScope('read:proyectos'), async (c) => c.json(await getStatus(ctxOf(c).tenantId)));

basecamp.post('/disconnect', requireScope('admin'), async (c) => {
  const ctx = ctxOf(c);
  await disconnect(ctx.tenantId);
  await audit(ctx, { accion: 'basecamp_desconectado', entidad: 'tenant', entidad_id: ctx.tenantId });
  return c.body(null, 204);
});
