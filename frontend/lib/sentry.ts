/**
 * Opciones comunes de Sentry para el navegador y el servidor de Next. Solo errores, solo si existe
 * NEXT_PUBLIC_SENTRY_DSN, sin datos de la persona ni de la petición. Las URL pierden el token del portal
 * (/p/<token>) y toda query string (p. ej. token_hash de /auth/establecer-clave).
 */
import type { ErrorEvent } from '@sentry/nextjs';

export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || undefined;

export function limpiarUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  const sinQuery = url.split(/[?#]/)[0] ?? '';
  return sinQuery.replace(/\/p\/[^/]+/, '/p/[redactado]');
}

export const opcionesSentry = {
  dsn: SENTRY_DSN,
  tracesSampleRate: 0,
  dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
  maxBreadcrumbs: 20,
  beforeSend(evento: ErrorEvent) {
    if (evento.request) evento.request = { method: evento.request.method, url: limpiarUrl(evento.request.url) };
    delete evento.user;
    evento.breadcrumbs = evento.breadcrumbs?.map((b) => ({
      ...b,
      data: b.data ? Object.fromEntries(Object.entries(b.data).map(([k, v]) => [k, typeof v === 'string' ? limpiarUrl(v) : v])) : b.data,
    }));
    return evento;
  },
};
