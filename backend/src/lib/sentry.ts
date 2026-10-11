/**
 * Sentry (solo errores). Activo únicamente si existe SENTRY_DSN. No envía datos personales ni de clientes:
 * sin IP, sin cuerpo ni cabeceras de la petición, y la URL pasa por redactarRuta (tokens del portal y secreto
 * del webhook fuera).
 */
import { redactarRuta } from './log';

// El SDK se carga solo si hay DSN: importarlo arrastra OpenTelemetry y hacía lento el arranque (y los tests).
let Sentry: typeof import('@sentry/node') | null = null;

export async function iniciarSentry(): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || Sentry) return;
  Sentry = await import('@sentry/node');
  Sentry.init({
    dsn,
    environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? 'development',
    // Nada de datos de la petición ni del usuario (por defecto Sentry 11 recoge cabeceras, cookies, cuerpos y query).
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    maxBreadcrumbs: 20,
    tracesSampleRate: 0,
    beforeSend(evento) {
      if (evento.request) {
        evento.request = {
          method: evento.request.method,
          url: evento.request.url ? redactarRuta(new URL(evento.request.url, 'http://x').pathname) : undefined,
        };
      }
      delete evento.user;
      return evento;
    },
  });
}

/** Envía un error del logger. Si entre los extras hay un Error, se manda ese (con su stack); si no, el mensaje. */
export function capturarError(mensaje: string, extra: unknown[]): void {
  const s = Sentry;
  if (!s) return;
  const err = extra.find((x): x is Error => x instanceof Error);
  s.withScope((scope) => {
    scope.setExtra('mensaje', mensaje);
    if (err) s.captureException(err);
    else s.captureMessage(mensaje, 'error');
  });
}

export async function vaciarSentry(): Promise<void> {
  if (Sentry) await Sentry.flush(2000);
}
