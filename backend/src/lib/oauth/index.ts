/**
 * Servidor OAuth 2.1 mínimo para clientes MCP (RFC 8414 metadata, RFC 7591 registro dinámico,
 * RFC 9728 protected resource, PKCE S256 obligatorio). Tokens opacos `bko_` (1 h) y `bkr_` (30 días),
 * guardados hasheados. El usuario autoriza con su sesión de BackIO en /oauth/consent (frontend).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { serviceClient, throwIf, DbError } from '../db/client';

export const SCOPES_SOPORTADOS = ['read:backlog', 'read:proyectos', 'read:senales', 'read:capacidad', 'write:requerimientos', 'write:proyectos', 'write:actas'] as const;

export function issuer(): string {
  return (process.env.BACKEND_PUBLIC_URL ?? 'http://localhost:4000').replace(/\/$/, '');
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const b64url = (b: Buffer) => b.toString('base64url');

export function metadataAuthServer() {
  const base = issuer();
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    scopes_supported: SCOPES_SOPORTADOS,
  };
}

export function metadataProtectedResource() {
  const base = issuer();
  return { resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: SCOPES_SOPORTADOS, bearer_methods_supported: ['header'] };
}

export interface OAuthClient { id: string; secret_hash: string | null; nombre: string; redirect_uris: string[] }

export async function registrarCliente(body: { client_name?: string; redirect_uris?: unknown; token_endpoint_auth_method?: string }): Promise<{ client_id: string; client_secret?: string; client_name: string; redirect_uris: string[]; token_endpoint_auth_method: string; grant_types: string[]; response_types: string[] }> {
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === 'string') : [];
  if (uris.length === 0) throw new DbError('redirect_uris requerido', 400);
  for (const u of uris) {
    const url = new URL(u);
    const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !localhost) throw new DbError(`redirect_uri debe ser https (o localhost): ${u}`, 400);
  }
  const publico = (body.token_endpoint_auth_method ?? 'none') === 'none';
  const id = `mcp_${randomBytes(12).toString('hex')}`;
  const secret = publico ? undefined : b64url(randomBytes(32));
  const { error } = await serviceClient().from('oauth_clients').insert({ id, secret_hash: secret ? sha256(secret) : null, nombre: body.client_name ?? 'Cliente MCP', redirect_uris: uris, metadata: body });
  throwIf(error);
  return { client_id: id, client_secret: secret, client_name: body.client_name ?? 'Cliente MCP', redirect_uris: uris, token_endpoint_auth_method: publico ? 'none' : 'client_secret_post', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] };
}

export async function getCliente(clientId: string): Promise<OAuthClient | null> {
  const { data, error } = await serviceClient().from('oauth_clients').select('id, secret_hash, nombre, redirect_uris').eq('id', clientId).maybeSingle();
  throwIf(error);
  return (data as OAuthClient) ?? null;
}

export function validarScopes(scope: string | undefined): string[] {
  const pedidos = (scope ?? '').split(/[\s+]+/).filter(Boolean);
  const validos = pedidos.filter((s) => (SCOPES_SOPORTADOS as readonly string[]).includes(s));
  return validos.length ? validos : ['read:backlog', 'read:proyectos', 'read:senales', 'read:capacidad'];
}

export async function emitirCodigo(p: { client_id: string; redirect_uri: string; code_challenge: string; scope: string[]; tenant_id: string; usuario_id: string }): Promise<string> {
  const code = b64url(randomBytes(32));
  const { error } = await serviceClient().from('oauth_codes').insert({ code, client_id: p.client_id, redirect_uri: p.redirect_uri, code_challenge: p.code_challenge, scope: p.scope.join(' '), tenant_id: p.tenant_id, usuario_id: p.usuario_id, expira_at: new Date(Date.now() + 5 * 60_000).toISOString() });
  throwIf(error);
  return code;
}

export interface TokenResponse { access_token: string; token_type: 'Bearer'; expires_in: number; refresh_token: string; scope: string }

async function emitirTokens(p: { client_id: string; tenant_id: string; usuario_id: string; scope: string }): Promise<TokenResponse> {
  const access = `bko_${b64url(randomBytes(32))}`;
  const refresh = `bkr_${b64url(randomBytes(32))}`;
  const ahora = Date.now();
  const { error } = await serviceClient().from('oauth_tokens').insert([
    { token_hash: sha256(access), tipo: 'access', client_id: p.client_id, tenant_id: p.tenant_id, usuario_id: p.usuario_id, scope: p.scope, expira_at: new Date(ahora + 3600_000).toISOString() },
    { token_hash: sha256(refresh), tipo: 'refresh', client_id: p.client_id, tenant_id: p.tenant_id, usuario_id: p.usuario_id, scope: p.scope, expira_at: new Date(ahora + 30 * 86_400_000).toISOString() },
  ]);
  throwIf(error);
  return { access_token: access, token_type: 'Bearer', expires_in: 3600, refresh_token: refresh, scope: p.scope };
}

function verificarSecreto(cliente: OAuthClient, secreto: string | undefined): boolean {
  if (!cliente.secret_hash) return true; // cliente público: PKCE es la protección
  if (!secreto) return false;
  const h = sha256(secreto);
  return h.length === cliente.secret_hash.length && timingSafeEqual(Buffer.from(h), Buffer.from(cliente.secret_hash));
}

export async function canjearCodigo(p: { code: string; client_id: string; client_secret?: string; redirect_uri?: string; code_verifier?: string }): Promise<TokenResponse> {
  const cliente = await getCliente(p.client_id);
  if (!cliente || !verificarSecreto(cliente, p.client_secret)) throw new DbError('invalid_client', 401);
  const db = serviceClient();
  const { data, error } = await db.from('oauth_codes').select('*').eq('code', p.code).eq('client_id', p.client_id).maybeSingle();
  throwIf(error);
  const c = data as { code: string; redirect_uri: string; code_challenge: string; scope: string; tenant_id: string; usuario_id: string; expira_at: string; usado_at: string | null } | null;
  if (!c) throw new DbError('invalid_grant', 400);
  if (c.usado_at || new Date(c.expira_at).getTime() < Date.now()) throw new DbError('invalid_grant', 400);
  if (p.redirect_uri && p.redirect_uri !== c.redirect_uri) throw new DbError('invalid_grant', 400);
  if (!p.code_verifier) throw new DbError('invalid_request: code_verifier requerido (PKCE)', 400);
  const esperado = b64url(createHash('sha256').update(p.code_verifier).digest());
  if (esperado !== c.code_challenge) throw new DbError('invalid_grant: PKCE no coincide', 400);
  const { data: marcado } = await db.from('oauth_codes').update({ usado_at: new Date().toISOString() }).eq('code', p.code).is('usado_at', null).select('code');
  if (!marcado?.length) throw new DbError('invalid_grant', 400);
  return emitirTokens({ client_id: p.client_id, tenant_id: c.tenant_id, usuario_id: c.usuario_id, scope: c.scope });
}

export async function refrescar(p: { refresh_token: string; client_id: string; client_secret?: string }): Promise<TokenResponse> {
  const cliente = await getCliente(p.client_id);
  if (!cliente || !verificarSecreto(cliente, p.client_secret)) throw new DbError('invalid_client', 401);
  const db = serviceClient();
  const { data, error } = await db.from('oauth_tokens').select('*').eq('token_hash', sha256(p.refresh_token)).eq('tipo', 'refresh').eq('client_id', p.client_id).maybeSingle();
  throwIf(error);
  const t = data as { tenant_id: string; usuario_id: string; scope: string; expira_at: string; revocado_at: string | null } | null;
  if (!t || t.revocado_at || new Date(t.expira_at).getTime() < Date.now()) throw new DbError('invalid_grant', 400);
  await db.from('oauth_tokens').update({ revocado_at: new Date().toISOString() }).eq('token_hash', sha256(p.refresh_token)); // rotación
  return emitirTokens({ client_id: p.client_id, tenant_id: t.tenant_id, usuario_id: t.usuario_id, scope: t.scope });
}

export async function revocar(token: string): Promise<void> {
  await serviceClient().from('oauth_tokens').update({ revocado_at: new Date().toISOString() }).eq('token_hash', sha256(token));
}

export interface AccessInfo { tenant_id: string; usuario_id: string; scopes: string[]; client_id: string }

export async function resolverAccessToken(token: string): Promise<AccessInfo | null> {
  const { data } = await serviceClient().from('oauth_tokens').select('tenant_id, usuario_id, scope, client_id, expira_at, revocado_at').eq('token_hash', sha256(token)).eq('tipo', 'access').maybeSingle();
  const t = data as { tenant_id: string; usuario_id: string; scope: string; client_id: string; expira_at: string; revocado_at: string | null } | null;
  if (!t || t.revocado_at || new Date(t.expira_at).getTime() < Date.now()) return null;
  return { tenant_id: t.tenant_id, usuario_id: t.usuario_id, scopes: t.scope.split(' ').filter(Boolean), client_id: t.client_id };
}
