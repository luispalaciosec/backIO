/**
 * Plan B ante el desfase de reloj de Supabase (26/11/2026). Auth emitía sesiones y la API de datos las rechazaba con
 * 401 PGRST303 «JWT issued at future»: su reloj iba atrasado respecto del de Auth. Todo el equipo quedó fuera.
 *
 * Cuando la API de datos responde PGRST303 a una sesión que Auth YA verificó, el backend firma un token propio para esa
 * misma sesión (mismo usuario, mismo rol, mismas claims; RLS aplica igual) con la clave anterior del proyecto
 * (SUPABASE_JWT_SECRET, HS256, que la API de datos sigue aceptando), con hora de emisión en el pasado y 5 minutos de
 * vida, y reintenta. Mientras dure el desfase (15 min desde el último rechazo) se usa directamente.
 *
 * Límites:
 *  - Sin SUPABASE_JWT_SECRET no hace nada.
 *  - Solo para tokens que pasaron por `auth.getUser` en este proceso (marcarTokenVerificado): un token falsificado
 *    nunca llega a firmarse.
 *  - Nunca toca la clave de servicio ni la anónima (solo role = authenticated).
 */
import { createHash, createHmac } from 'node:crypto';
import { log } from '../logger';

const DESFASE_MS = 15 * 60_000;
const VIDA_TOKEN_S = 300;
const EMISION_ATRAS_S = 3600; // tolera un reloj atrasado hasta una hora
const MAX_VERIFICADOS = 2000;

let desfaseHasta = 0;
const verificados = new Map<string, number>(); // hash del token → hasta cuándo vale (ms)

const secreto = () => process.env.SUPABASE_JWT_SECRET?.trim() || null;
const hash = (jwt: string) => createHash('sha256').update(jwt).digest('hex');

function payloadDe(jwt: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Lo llama el middleware después de que Auth aceptó el token. */
export function marcarTokenVerificado(jwt: string, venceMs: number): void {
  if (venceMs <= Date.now()) return;
  if (verificados.size >= MAX_VERIFICADOS) verificados.delete(verificados.keys().next().value as string);
  verificados.set(hash(jwt), venceMs);
}

/** Solo para tests. */
export function reiniciarReloj(): void {
  desfaseHasta = 0;
  verificados.clear();
}

export const hayDesfase = (ahora = Date.now()) => ahora < desfaseHasta;

function verificado(jwt: string, ahora: number): boolean {
  const hasta = verificados.get(hash(jwt));
  return hasta !== undefined && hasta > ahora;
}

function b64(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

/** Token de respaldo para la misma sesión: mismas claims, emisión en el pasado, vida corta, firma HS256. */
export function firmarRespaldo(jwt: string, clave: string, ahoraS = Math.floor(Date.now() / 1000)): string | null {
  const p = payloadDe(jwt);
  if (!p || p.role !== 'authenticated' || typeof p.sub !== 'string') return null;
  const expOriginal = typeof p.exp === 'number' ? p.exp : ahoraS + VIDA_TOKEN_S;
  const cuerpo = { ...p, iat: ahoraS - EMISION_ATRAS_S, exp: Math.min(expOriginal, ahoraS + VIDA_TOKEN_S) };
  const base = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(cuerpo)}`;
  return `${base}.${createHmac('sha256', clave).update(base).digest('base64url')}`;
}

function bearer(headers: Headers): string | null {
  const v = headers.get('authorization') ?? '';
  return v.toLowerCase().startsWith('bearer ') ? v.slice(7).trim() : null;
}

/** Envuelve el fetch de supabase-js (va debajo del disyuntor). */
export function fetchConRelojTolerante(base: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const clave = secreto();
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!clave || !url.includes('/rest/v1/')) return base(input, init);
    const headers = new Headers(init?.headers);
    const jwt = bearer(headers);
    const ahora = Date.now();
    if (!jwt || !verificado(jwt, ahora)) return base(input, init);

    const conRespaldo = () => {
      const t = firmarRespaldo(jwt, clave);
      if (!t) return null;
      const h = new Headers(headers);
      h.set('authorization', `Bearer ${t}`);
      return { ...init, headers: h };
    };

    if (hayDesfase(ahora)) {
      const r = conRespaldo();
      if (r) return base(input, r);
    }
    const res = await base(input, init);
    if (res.status !== 401) return res;
    const cuerpo = await res
      .clone()
      .text()
      .catch(() => '');
    if (!cuerpo.includes('PGRST303')) return res;
    const r = conRespaldo();
    if (!r) return res;
    if (!hayDesfase(ahora))
      log.warn('[auth] la API de datos rechaza sesiones por reloj desfasado (PGRST303); se usa el token de respaldo por 15 min');
    desfaseHasta = ahora + DESFASE_MS;
    return base(input, r);
  };
}
