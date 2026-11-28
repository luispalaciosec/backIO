/**
 * OAuth2 de Google para el calendario de cada persona (reuniones, fase 2, docs/23). Permisos: `openid`, `email` (para
 * comprobar que la persona conecta SU cuenta) y `calendar.events.readonly`. La app de Google es «Interna»: solo cuentas
 * del dominio de la agencia.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';
import type { TokensGoogle } from '../db/google';

export const ALCANCES_GOOGLE = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events.readonly'];

export function googleConfigurado(): boolean {
  const e = env();
  return !!(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET && e.GOOGLE_REDIRECT_URI);
}

function config() {
  const e = env();
  if (!e.GOOGLE_CLIENT_ID || !e.GOOGLE_CLIENT_SECRET || !e.GOOGLE_REDIRECT_URI) throw new Error('Google Calendar no está configurado');
  return { id: e.GOOGLE_CLIENT_ID, secreto: e.GOOGLE_CLIENT_SECRET, redirect: e.GOOGLE_REDIRECT_URI };
}

const firmar = (payload: string) => createHmac('sha256', config().secreto).update(`google:${payload}`).digest('base64url');

/** `state` firmado (HMAC) con tenant, persona y expiración de 10 minutos. */
export function estadoGoogle(tenantId: string, usuarioId: string, ahora = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ t: tenantId, u: usuarioId, n: randomBytes(8).toString('hex'), e: ahora + 10 * 60_000 }),
  ).toString('base64url');
  return `${payload}.${firmar(payload)}`;
}

export function verificarEstadoGoogle(state: string, ahora = Date.now()): { tenantId: string; usuarioId: string } | null {
  const [payload, sig] = state.split('.');
  if (!payload || !sig) return null;
  const esperado = firmar(payload);
  if (sig.length !== esperado.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { t: string; u: string; e: number };
    return ahora > d.e ? null : { tenantId: d.t, usuarioId: d.u };
  } catch {
    return null;
  }
}

export function urlAutorizacionGoogle(state: string, emailSugerido?: string | null): string {
  const c = config();
  const q = new URLSearchParams({
    client_id: c.id,
    redirect_uri: c.redirect,
    response_type: 'code',
    scope: ALCANCES_GOOGLE.join(' '),
    access_type: 'offline', // refresh_token: para leer el calendario cada 2 h sin que la persona vuelva a entrar
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    ...(emailSugerido ? { login_hint: emailSugerido } : {}),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function token(params: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const c = config();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.id, client_secret: c.secreto, ...params }),
  });
  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ErrorGoogle(cuerpo.error ?? `HTTP ${res.status}`, res.status);
  }
  return (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
}

export class ErrorGoogle extends Error {
  constructor(
    readonly codigo: string,
    readonly status: number,
  ) {
    super(`Google respondió ${codigo}`);
  }
  /** El permiso ya no sirve (revocado, contraseña cambiada, cuenta suspendida): hay que reconectar. */
  get revocado(): boolean {
    return this.codigo === 'invalid_grant' || this.status === 401;
  }
}

export async function canjearCodigoGoogle(code: string): Promise<{ tokens: TokensGoogle; email: string }> {
  const r = await token({ code, grant_type: 'authorization_code', redirect_uri: config().redirect });
  if (!r.refresh_token) throw new Error('Google no entregó permiso permanente; vuelve a conectar');
  const info = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${r.access_token}` } });
  if (!info.ok) throw new Error('No se pudo leer el correo de la cuenta de Google');
  const { email, email_verified } = (await info.json()) as { email?: string; email_verified?: boolean };
  if (!email || email_verified === false) throw new Error('La cuenta de Google no tiene un correo verificado');
  return {
    tokens: {
      access_token: r.access_token,
      refresh_token: r.refresh_token,
      expires_at: new Date(Date.now() + r.expires_in * 1000).toISOString(),
    },
    email: email.toLowerCase(),
  };
}

export async function renovarTokensGoogle(t: TokensGoogle): Promise<TokensGoogle> {
  const r = await token({ refresh_token: t.refresh_token, grant_type: 'refresh_token' });
  return {
    access_token: r.access_token,
    refresh_token: r.refresh_token ?? t.refresh_token,
    expires_at: new Date(Date.now() + r.expires_in * 1000).toISOString(),
  };
}
