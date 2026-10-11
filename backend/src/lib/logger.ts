/**
 * Logger con niveles (auditoría 10/10, Ola 7). En producción escribe una línea JSON por evento, que Railway indexa;
 * en desarrollo, texto legible. Los errores van además a Sentry si existe SENTRY_DSN (lib/sentry.ts).
 * Uso igual que console: log.error('[scheduler] reconcile falló', err) — el primer argumento es el mensaje.
 * Nunca pasar aquí payloads de webhooks, tokens ni datos del cliente: solo ids, conteos y mensajes de error.
 */
import { capturarError } from './sentry';

type Nivel = 'debug' | 'info' | 'warn' | 'error';
const ORDEN: Record<Nivel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const produccion = () => process.env.NODE_ENV === 'production';
const minimo = (): Nivel => (process.env.LOG_LEVEL as Nivel | undefined) ?? (produccion() ? 'info' : 'debug');

/** Error → objeto plano (Error no se serializa con JSON.stringify). */
export function serializar(v: unknown): unknown {
  if (v instanceof Error) return { nombre: v.name, mensaje: v.message, stack: v.stack?.split('\n').slice(0, 8).join('\n') };
  return v;
}

function escribir(nivel: Nivel, mensaje: string, extra: unknown[]): void {
  if (ORDEN[nivel] < ORDEN[minimo()]) return;
  const salida = nivel === 'error' ? console.error : nivel === 'warn' ? console.warn : console.log;
  if (produccion()) {
    const linea: Record<string, unknown> = { nivel, msg: mensaje, ts: new Date().toISOString() };
    if (extra.length) linea.extra = extra.map(serializar);
    salida(JSON.stringify(linea));
  } else {
    salida(`[${nivel}] ${mensaje}`, ...extra);
  }
  if (nivel === 'error') capturarError(mensaje, extra);
}

export const log = {
  debug: (mensaje: string, ...extra: unknown[]) => escribir('debug', mensaje, extra),
  info: (mensaje: string, ...extra: unknown[]) => escribir('info', mensaje, extra),
  warn: (mensaje: string, ...extra: unknown[]) => escribir('warn', mensaje, extra),
  error: (mensaje: string, ...extra: unknown[]) => escribir('error', mensaje, extra),
};
