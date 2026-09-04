/**
 * Cliente HTTP hacia el backend. Sin localStorage para datos de negocio:
 * el token viene de la sesión Supabase. Los componentes nunca consultan Supabase para datos.
 */
import { supabaseBrowser } from './supabase/client';

export const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(public status: number, message: string, public detalle?: unknown) {
    super(message);
  }
}

async function token(): Promise<string | null> {
  const { data } = await supabaseBrowser().auth.getSession();
  return data.session?.access_token ?? null;
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const t = await token();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (t) headers.Authorization = `Bearer ${t}`;
  let body = init.body;
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`${BACKEND}/api/v1${path}`, { ...init, headers, body, cache: 'no-store' });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string; detalle?: unknown } & T;
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Error ${res.status}`, data.detalle);
  return data;
}

/** Llamada autenticada a una ruta del backend fuera de /api/v1 (p. ej. /oauth/approve). */
export async function apiRaw<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const t = await token();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (t) headers.Authorization = `Bearer ${t}`;
  let body = init.body;
  if (init.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(init.json); }
  const res = await fetch(`${BACKEND}${path}`, { ...init, headers, body, cache: 'no-store' });
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Error ${res.status}`);
  return data;
}

/** Fetch público del portal (sin auth). */
export async function apiPortal<T>(path: string, init: RequestInit = {}, pin?: string): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (pin) headers['X-Portal-Pin'] = pin;
  const res = await fetch(`${BACKEND}/api/portal${path}`, { ...init, headers, cache: 'no-store' });
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Error ${res.status}`, data);
  return data;
}
