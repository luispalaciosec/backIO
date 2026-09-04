/**
 * OAuth2 de Basecamp 3 (Launchpad), a nivel de organización.
 *  - start: URL de autorización con `state` firmado (HMAC) que lleva tenant_id + usuario + expiración.
 *  - callback: canjea el code por access/refresh token y los guarda en tenants.config.basecamp.
 *  - status: si está conectado, cuándo expira y qué cuenta autorizó.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';
import { serviceClient, throwIf } from '../db/client';
import type { BasecampTokens } from './client';

const LAUNCHPAD = 'https://launchpad.37signals.com';

function secret(): string {
  const s = env().BASECAMP_CLIENT_SECRET;
  if (!s) throw new Error('BASECAMP_CLIENT_SECRET no configurada');
  return s;
}

function firmar(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function buildState(tenantId: string, usuarioId: string): string {
  const payload = Buffer.from(JSON.stringify({ t: tenantId, u: usuarioId, n: randomBytes(8).toString('hex'), e: Date.now() + 10 * 60_000 })).toString('base64url');
  return `${payload}.${firmar(payload)}`;
}

export function verifyState(state: string): { tenantId: string; usuarioId: string } | null {
  const [payload, sig] = state.split('.');
  if (!payload || !sig) return null;
  const esperado = firmar(payload);
  if (sig.length !== esperado.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { t: string; u: string; e: number };
  if (Date.now() > data.e) return null;
  return { tenantId: data.t, usuarioId: data.u };
}

export function authorizationUrl(state: string): string {
  const e = env();
  if (!e.BASECAMP_CLIENT_ID || !e.BASECAMP_REDIRECT_URI) throw new Error('BASECAMP_CLIENT_ID / BASECAMP_REDIRECT_URI no configuradas');
  const q = new URLSearchParams({ type: 'web_server', client_id: e.BASECAMP_CLIENT_ID, redirect_uri: e.BASECAMP_REDIRECT_URI, state });
  return `${LAUNCHPAD}/authorization/new?${q}`;
}

export async function exchangeCode(code: string): Promise<BasecampTokens> {
  const e = env();
  const q = new URLSearchParams({
    type: 'web_server',
    client_id: e.BASECAMP_CLIENT_ID ?? '',
    redirect_uri: e.BASECAMP_REDIRECT_URI ?? '',
    client_secret: secret(),
    code,
  });
  const res = await fetch(`${LAUNCHPAD}/authorization/token?${q}`, { method: 'POST', headers: { 'User-Agent': e.BASECAMP_USER_AGENT } });
  if (!res.ok) throw new Error(`Basecamp rechazó el code (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: new Date(Date.now() + body.expires_in * 1000).toISOString(),
  };
}

export async function refreshTokens(tokens: BasecampTokens): Promise<BasecampTokens> {
  const e = env();
  const q = new URLSearchParams({ type: 'refresh', refresh_token: tokens.refresh_token, client_id: e.BASECAMP_CLIENT_ID ?? '', client_secret: secret() });
  const res = await fetch(`${LAUNCHPAD}/authorization/token?${q}`, { method: 'POST', headers: { 'User-Agent': e.BASECAMP_USER_AGENT } });
  if (!res.ok) throw new Error(`Refresh de token Basecamp falló: ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  return { access_token: body.access_token, refresh_token: tokens.refresh_token, expires_at: new Date(Date.now() + body.expires_in * 1000).toISOString() };
}

export interface BasecampAuthInfo {
  identity: { email_address: string; first_name: string; last_name: string };
  accounts: { id: number; name: string; product: string; href: string }[];
}

export async function authorizationInfo(accessToken: string): Promise<BasecampAuthInfo> {
  const res = await fetch(`${LAUNCHPAD}/authorization.json`, { headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': env().BASECAMP_USER_AGENT } });
  if (!res.ok) throw new Error(`authorization.json falló: ${res.status}`);
  return (await res.json()) as BasecampAuthInfo;
}

export interface BasecampConfig extends BasecampTokens {
  cuenta_id: number | null;
  cuenta_nombre: string | null;
  autorizado_por: string | null;
  conectado_at: string;
}

export async function saveTokens(tenantId: string, tokens: BasecampTokens, extra: Omit<BasecampConfig, keyof BasecampTokens>): Promise<void> {
  const db = serviceClient();
  const { data, error } = await db.from('tenants').select('config').eq('id', tenantId).single();
  throwIf(error);
  const cfg = (data as { config: Record<string, unknown> }).config ?? {};
  const { error: e2 } = await db.from('tenants').update({ config: { ...cfg, basecamp: { ...tokens, ...extra } } }).eq('id', tenantId);
  throwIf(e2);
}

export async function getStatus(tenantId: string): Promise<{ conectado: boolean; cuenta?: string | null; cuenta_id?: number | null; autorizado_por?: string | null; expira_at?: string; conectado_at?: string }> {
  const { data, error } = await serviceClient().from('tenants').select('config').eq('id', tenantId).single();
  throwIf(error);
  const bc = (data as { config: { basecamp?: BasecampConfig } }).config.basecamp;
  if (!bc?.access_token) return { conectado: false };
  return { conectado: true, cuenta: bc.cuenta_nombre, cuenta_id: bc.cuenta_id, autorizado_por: bc.autorizado_por, expira_at: bc.expires_at, conectado_at: bc.conectado_at };
}

export async function disconnect(tenantId: string): Promise<void> {
  const db = serviceClient();
  const { data, error } = await db.from('tenants').select('config').eq('id', tenantId).single();
  throwIf(error);
  const { basecamp: _b, ...rest } = ((data as { config: Record<string, unknown> }).config ?? {}) as Record<string, unknown>;
  const { error: e2 } = await db.from('tenants').update({ config: rest }).eq('id', tenantId);
  throwIf(e2);
}
