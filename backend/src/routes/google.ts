/** Vuelta pública desde Google (reuniones, fase 2, docs/23). El `state` firmado identifica tenant y persona. */
import { Hono } from 'hono';
import { frontendOrigins } from '../config/env';
import { audit, serviceClient } from '../lib/db';
import { guardarGoogle } from '../lib/db/google';
import { usuarioParaBasecamp } from '../lib/db/usuarios';
import { canjearCodigoGoogle, verificarEstadoGoogle } from '../lib/google/oauth';

export const googleOAuth = new Hono();

const volver = (p: Record<string, string>) => `${frontendOrigins()[0] ?? 'http://localhost:3000'}/mi-google?${new URLSearchParams(p)}`;

googleOAuth.get('/oauth/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (c.req.query('error')) return c.redirect(volver({ google: 'error', motivo: 'Cancelaste el permiso en Google' }));
  if (!code || !state) return c.redirect(volver({ google: 'error', motivo: 'Faltan datos de Google; vuelve a intentar' }));
  const ctx = verificarEstadoGoogle(state);
  if (!ctx) return c.redirect(volver({ google: 'error', motivo: 'El enlace venció; vuelve a pulsar «Conectar»' }));
  try {
    const usuario = await usuarioParaBasecamp(ctx.tenantId, ctx.usuarioId);
    if (!usuario?.activo) return c.redirect(volver({ google: 'error', motivo: 'Usuario no encontrado' }));
    const { tokens, email } = await canjearCodigoGoogle(code);
    // Solo SU calendario: el correo de Google tiene que ser el de la persona en BackIO.
    if (email !== usuario.email.trim().toLowerCase()) {
      return c.redirect(volver({ google: 'error', motivo: `Conectaste ${email}; usa tu cuenta ${usuario.email}` }));
    }
    await guardarGoogle(ctx.tenantId, ctx.usuarioId, email, tokens);
    await audit(
      { db: serviceClient(), tenantId: ctx.tenantId, usuarioId: ctx.usuarioId, origen: 'ui' },
      { accion: 'google_conectado', entidad: 'usuario', entidad_id: ctx.usuarioId, detalle: { email } },
    );
    return c.redirect(volver({ google: 'ok' }));
  } catch (err) {
    return c.redirect(volver({ google: 'error', motivo: err instanceof Error ? err.message : 'No se pudo conectar' }));
  }
});
