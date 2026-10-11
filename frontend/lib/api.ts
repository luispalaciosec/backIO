/**
 * Cliente HTTP hacia el backend. Sin localStorage para datos de negocio:
 * el token viene de la sesión Supabase. Los componentes nunca consultan Supabase para datos.
 *
 * Un solo núcleo (`pedir`) para todas las variantes (auditoría 10/10): antes eran cuatro copias y una respuesta 2xx
 * que no era JSON se devolvía como `{}` disfrazado de T.
 */
import { supabaseBrowser } from './supabase/client';

export const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detalle?: unknown,
  ) {
    super(message);
  }
}

/** Mensaje legible de un cuerpo de error: `error` texto, o un error de validación con campos (B3). */
export function mensajeDeError(cuerpo: unknown, status: number): string {
  const e = (cuerpo as { error?: unknown } | null)?.error;
  if (typeof e === 'string' && e) return e;
  const issues = (e as { issues?: { path?: (string | number)[] }[] } | undefined)?.issues;
  if (Array.isArray(issues) && issues.length) {
    const campos = [...new Set(issues.map((i) => (i.path ?? []).join('.')).filter(Boolean))];
    return campos.length ? `Revisa: ${campos.join(', ')}` : 'Revisa los datos enviados';
  }
  if (status === 401) return 'Tu sesión expiró. Vuelve a ingresar.';
  if (status >= 500) return 'El servidor no respondió bien. Intenta de nuevo en un momento.';
  return `Error ${status}`;
}

type Init = RequestInit & { json?: unknown; token?: string | null; pin?: string };

/** Núcleo: arma la petición, conserva 204, falla de verdad si la respuesta no es lo esperado. */
export async function pedir<T>(url: string, init: Init = {}): Promise<T> {
  const { json, token, pin, ...resto } = init;
  const headers: Record<string, string> = { ...(resto.headers as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (pin) headers['X-Portal-Pin'] = pin;
  let body = resto.body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }
  const res = await fetch(url, { ...resto, headers, body, cache: 'no-store' });
  if (res.status === 204) return undefined as T;
  const texto = await res.text();
  let datos: unknown = undefined;
  try {
    datos = texto ? JSON.parse(texto) : undefined;
  } catch {
    // No es JSON: se decide abajo según el estado.
  }
  if (!res.ok) {
    const d = datos as { detalle?: unknown } | undefined;
    throw new ApiError(res.status, mensajeDeError(datos, res.status), d?.detalle ?? datos);
  }
  if (datos === undefined) throw new ApiError(res.status, 'Respuesta inesperada del servidor');
  return datos as T;
}

async function token(): Promise<string | null> {
  const { data } = await supabaseBrowser().auth.getSession();
  return data.session?.access_token ?? null;
}

/** API v1 autenticada con la sesión del navegador. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  return pedir<T>(`${BACKEND}/api/v1${path}`, { ...init, token: await token() });
}

/** Llamada autenticada a una ruta del backend fuera de /api/v1 (p. ej. /oauth/approve). */
export async function apiRaw<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  return pedir<T>(`${BACKEND}${path}`, { ...init, token: await token() });
}

/** Fetch público del portal (sin auth; PIN opcional). */
export async function apiPortal<T>(path: string, init: RequestInit = {}, pin?: string): Promise<T> {
  return pedir<T>(`${BACKEND}/api/portal${path}`, { ...init, pin });
}
