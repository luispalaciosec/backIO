import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { frontendOrigins } from '../config/env';
import { DbError } from '../lib/db/client';
import { requireAuth, ctxOf } from '../lib/auth/middleware';
import { audit } from '../lib/db/audit';
import { metadataAuthServer, metadataProtectedResource, registrarCliente, getCliente, validarScopes, emitirCodigo, canjearCodigo, refrescar, revocar } from '../lib/oauth';

export const wellKnown = new Hono();
wellKnown.get('/oauth-authorization-server', (c) => c.json(metadataAuthServer()));
wellKnown.get('/oauth-protected-resource', (c) => c.json(metadataProtectedResource()));
wellKnown.get('/oauth-protected-resource/mcp', (c) => c.json(metadataProtectedResource()));

export const oauth = new Hono();

const oauthError = (c: { json: (b: unknown, s: 400 | 401) => Response }, err: unknown) => {
  const msg = err instanceof Error ? err.message : 'server_error';
  const [code, desc] = msg.includes(':') ? [msg.split(':')[0]!, msg.split(':').slice(1).join(':').trim()] : [msg, undefined];
  return c.json({ error: code, error_description: desc }, err instanceof DbError && err.status === 401 ? 401 : 400);
};

oauth.post('/register', async (c) => {
  try { return c.json(await registrarCliente(await c.req.json()), 201); }
  catch (err) { return oauthError(c, err); }
});

/** Paso 1: el cliente MCP llega aquí; validamos y mandamos al consentimiento del frontend (requiere login). */
oauth.get('/authorize', async (c) => {
  const q = c.req.query();
  const cliente = q.client_id ? await getCliente(q.client_id) : null;
  if (!cliente) return c.json({ error: 'invalid_client' }, 400);
  if (!q.redirect_uri || !cliente.redirect_uris.includes(q.redirect_uri)) return c.json({ error: 'invalid_request', error_description: 'redirect_uri no registrada' }, 400);
  const fallo = (e: string, d: string) => c.redirect(`${q.redirect_uri}?${new URLSearchParams({ error: e, error_description: d, ...(q.state ? { state: q.state } : {}) })}`);
  if (q.response_type !== 'code') return fallo('unsupported_response_type', 'solo code');
  if (!q.code_challenge || (q.code_challenge_method ?? 'S256') !== 'S256') return fallo('invalid_request', 'PKCE S256 obligatorio');
  const front = frontendOrigins()[0] ?? 'http://localhost:3000';
  const params = new URLSearchParams({ client_id: q.client_id!, client_name: cliente.nombre, redirect_uri: q.redirect_uri, code_challenge: q.code_challenge, scope: validarScopes(q.scope).join(' '), ...(q.state ? { state: q.state } : {}) });
  return c.redirect(`${front}/oauth/consent?${params}`);
});

/** Paso 2: el frontend, con la sesión del usuario, aprueba y recibe la URL de retorno con el code. */
oauth.post('/approve', requireAuth, zValidator('json', z.object({ client_id: z.string(), redirect_uri: z.string().url(), code_challenge: z.string().min(20), scope: z.string().optional(), state: z.string().optional() })), async (c) => {
  const auth = c.get('auth');
  if (auth.tipo !== 'usuario' || !auth.ctx.usuarioId) return c.json({ error: 'Solo usuarios pueden autorizar clientes' }, 403);
  const b = c.req.valid('json');
  const cliente = await getCliente(b.client_id);
  if (!cliente || !cliente.redirect_uris.includes(b.redirect_uri)) return c.json({ error: 'invalid_client' }, 400);
  const scopes = validarScopes(b.scope);
  const code = await emitirCodigo({ client_id: b.client_id, redirect_uri: b.redirect_uri, code_challenge: b.code_challenge, scope: scopes, tenant_id: auth.ctx.tenantId, usuario_id: auth.ctx.usuarioId });
  await audit(ctxOf(c), { accion: 'oauth_autorizar', entidad: 'oauth_client', detalle: { client_id: b.client_id, cliente: cliente.nombre, scopes } });
  return c.json({ redirect: `${b.redirect_uri}?${new URLSearchParams({ code, ...(b.state ? { state: b.state } : {}) })}` });
});

oauth.post('/token', async (c) => {
  const ct = c.req.header('content-type') ?? '';
  const body = (ct.includes('json') ? await c.req.json() : Object.fromEntries((await c.req.formData()).entries())) as Record<string, string | undefined>;
  try {
    if (body.grant_type === 'authorization_code') {
      return c.json(await canjearCodigo({ code: body.code ?? '', client_id: body.client_id ?? '', client_secret: body.client_secret, redirect_uri: body.redirect_uri, code_verifier: body.code_verifier }));
    }
    if (body.grant_type === 'refresh_token') {
      return c.json(await refrescar({ refresh_token: body.refresh_token ?? '', client_id: body.client_id ?? '', client_secret: body.client_secret }));
    }
    return c.json({ error: 'unsupported_grant_type' }, 400);
  } catch (err) { return oauthError(c, err); }
});

oauth.post('/revoke', async (c) => {
  const body = Object.fromEntries((await c.req.formData()).entries()) as Record<string, string>;
  if (body.token) await revocar(body.token);
  return c.body(null, 200);
});
