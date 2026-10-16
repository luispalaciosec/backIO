/** Callback público de OAuth (Basecamp redirige aquí). El state firmado identifica tenant y usuario. */
import { Hono } from 'hono';
import { env, frontendOrigins } from '../config/env';
import { verifyState, exchangeCode, authorizationInfo, perfilBasecamp, saveTokens } from '../lib/basecamp/oauth';
import { serviceClient, audit } from '../lib/db';
import { validarIdentidadPersona } from '../lib/basecamp/persona';
import { fijarBasecampUserId, usuarioParaBasecamp } from '../lib/db/usuarios';
import { guardarCredencialesPersona } from '../lib/db/credenciales';

export const basecampOAuth = new Hono();

/** La conexión de la organización vuelve a Admin → Integraciones; la de una persona, a Mi Basecamp. */
function volverAlFrontend(params: Record<string, string>, pagina = '/admin/integraciones'): string {
  const base = frontendOrigins()[0] ?? 'http://localhost:3000';
  return `${base}${pagina}?${new URLSearchParams(params)}`;
}

basecampOAuth.get('/oauth/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) return c.redirect(volverAlFrontend({ basecamp: 'error', motivo: 'faltan code o state' }));
  const ctx = verifyState(state);
  if (!ctx) return c.redirect(volverAlFrontend({ basecamp: 'error', motivo: 'state inválido o expirado; vuelve a iniciar' }));
  if (ctx.modo === 'persona') return c.redirect(await conectarPersona(code, ctx));
  try {
    const tokens = await exchangeCode(code);
    const info = await authorizationInfo(tokens.access_token);
    const esperado = env().BASECAMP_ACCOUNT_ID ? Number(env().BASECAMP_ACCOUNT_ID) : null;
    const cuenta =
      info.accounts.find((a) => a.product === 'bc3' && (esperado === null || a.id === esperado)) ??
      info.accounts.find((a) => a.product === 'bc3') ??
      null;
    if (esperado !== null && cuenta?.id !== esperado) {
      return c.redirect(
        volverAlFrontend({
          basecamp: 'error',
          motivo: `La cuenta autorizada no es la ${esperado}. Cuentas disponibles: ${info.accounts.map((a) => `${a.name} (${a.id})`).join(', ')}`,
        }),
      );
    }
    await saveTokens(ctx.tenantId, tokens, {
      cuenta_id: cuenta?.id ?? null,
      cuenta_nombre: cuenta?.name ?? null,
      autorizado_por: info.identity.email_address,
      conectado_at: new Date().toISOString(),
    });
    await audit(
      { db: serviceClient(), tenantId: ctx.tenantId, usuarioId: ctx.usuarioId, origen: 'ui' },
      {
        accion: 'basecamp_conectado',
        entidad: 'tenant',
        entidad_id: ctx.tenantId,
        detalle: { cuenta_id: cuenta?.id ?? null, autorizado_por: info.identity.email_address },
      },
    );
    return c.redirect(volverAlFrontend({ basecamp: 'ok' }));
  } catch (err) {
    return c.redirect(volverAlFrontend({ basecamp: 'error', motivo: err instanceof Error ? err.message : 'error desconocido' }));
  }
});

/**
 * Cuenta de Basecamp de una persona (migración 33): solo si es SU cuenta (validarIdentidadPersona). Devuelve la URL a
 * la que vuelve el navegador.
 */
async function conectarPersona(code: string, ctx: { tenantId: string; usuarioId: string }): Promise<string> {
  const volver = (p: Record<string, string>) => volverAlFrontend(p, '/mi-basecamp');
  try {
    const tokens = await exchangeCode(code);
    const info = await authorizationInfo(tokens.access_token);
    const esperado = env().BASECAMP_ACCOUNT_ID ? Number(env().BASECAMP_ACCOUNT_ID) : null;
    if (esperado !== null && !info.accounts.some((a) => a.product === 'bc3' && a.id === esperado)) {
      return volver({ basecamp: 'error', motivo: 'Esa cuenta de Basecamp no tiene acceso a la cuenta de Geeks' });
    }
    const usuario = await usuarioParaBasecamp(ctx.tenantId, ctx.usuarioId);
    if (!usuario) return volver({ basecamp: 'error', motivo: 'Usuario no encontrado' });
    // La persona de Basecamp sale del perfil en la cuenta de Geeks, no de identity.id (otro número).
    const perfil = await perfilBasecamp(tokens.access_token);
    const v = validarIdentidadPersona(usuario, perfil);
    if (!v.ok) return volver({ basecamp: 'error', motivo: v.motivo });
    if (v.enlazar) await fijarBasecampUserId(ctx.tenantId, ctx.usuarioId, perfil.id);
    await guardarCredencialesPersona(ctx.tenantId, ctx.usuarioId, perfil.id, { ...tokens, email: perfil.email_address });
    await audit(
      { db: serviceClient(), tenantId: ctx.tenantId, usuarioId: ctx.usuarioId, origen: 'ui' },
      {
        accion: 'basecamp_persona_conectada',
        entidad: 'usuario',
        entidad_id: ctx.usuarioId,
        detalle: { basecamp_person_id: perfil.id, email: perfil.email_address, enlazado: v.enlazar },
      },
    );
    return volver({ basecamp: 'ok' });
  } catch (err) {
    return volver({ basecamp: 'error', motivo: err instanceof Error ? err.message : 'error desconocido' });
  }
}
