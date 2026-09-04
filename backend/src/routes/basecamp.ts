/** Callback público de OAuth (Basecamp redirige aquí). El state firmado identifica tenant y usuario. */
import { Hono } from 'hono';
import { env, frontendOrigins } from '../config/env';
import { verifyState, exchangeCode, authorizationInfo, saveTokens } from '../lib/basecamp/oauth';
import { serviceClient, audit } from '../lib/db';

export const basecampOAuth = new Hono();

function volverAlFrontend(params: Record<string, string>): string {
  const base = frontendOrigins()[0] ?? 'http://localhost:3000';
  return `${base}/admin/integraciones?${new URLSearchParams(params)}`;
}

basecampOAuth.get('/oauth/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) return c.redirect(volverAlFrontend({ basecamp: 'error', motivo: 'faltan code o state' }));
  const ctx = verifyState(state);
  if (!ctx) return c.redirect(volverAlFrontend({ basecamp: 'error', motivo: 'state inválido o expirado; vuelve a iniciar' }));
  try {
    const tokens = await exchangeCode(code);
    const info = await authorizationInfo(tokens.access_token);
    const esperado = env().BASECAMP_ACCOUNT_ID ? Number(env().BASECAMP_ACCOUNT_ID) : null;
    const cuenta = info.accounts.find((a) => a.product === 'bc3' && (esperado === null || a.id === esperado)) ?? info.accounts.find((a) => a.product === 'bc3') ?? null;
    if (esperado !== null && cuenta?.id !== esperado) {
      return c.redirect(volverAlFrontend({ basecamp: 'error', motivo: `La cuenta autorizada no es la ${esperado}. Cuentas disponibles: ${info.accounts.map((a) => `${a.name} (${a.id})`).join(', ')}` }));
    }
    await saveTokens(ctx.tenantId, tokens, {
      cuenta_id: cuenta?.id ?? null,
      cuenta_nombre: cuenta?.name ?? null,
      autorizado_por: info.identity.email_address,
      conectado_at: new Date().toISOString(),
    });
    await audit({ db: serviceClient(), tenantId: ctx.tenantId, usuarioId: ctx.usuarioId, origen: 'ui' }, {
      accion: 'basecamp_conectado', entidad: 'tenant', entidad_id: ctx.tenantId,
      detalle: { cuenta_id: cuenta?.id ?? null, autorizado_por: info.identity.email_address },
    });
    return c.redirect(volverAlFrontend({ basecamp: 'ok' }));
  } catch (err) {
    return c.redirect(volverAlFrontend({ basecamp: 'error', motivo: err instanceof Error ? err.message : 'error desconocido' }));
  }
});
