import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { log, serializar } from '../lib/logger';
import { DbError } from '../lib/db/client';
import { redactarRuta } from '../lib/log';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('logger', () => {
  it('en producción escribe una línea JSON con nivel y el error serializado', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const salida = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    log.error('[jobs] reconcile falló', new Error('Supabase caído'));
    const linea = JSON.parse(String(salida.mock.calls[0]![0]));
    expect(linea).toMatchObject({ nivel: 'error', msg: '[jobs] reconcile falló', extra: [{ nombre: 'Error', mensaje: 'Supabase caído' }] });
  });
  it('respeta el nivel mínimo', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LOG_LEVEL', 'warn');
    const info = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    log.info('ruido');
    expect(info).not.toHaveBeenCalled();
  });
  it('serializa errores y deja pasar el resto', () => {
    expect(serializar(new TypeError('x'))).toMatchObject({ nombre: 'TypeError', mensaje: 'x' });
    expect(serializar({ a: 1 })).toEqual({ a: 1 });
  });
});

// Un 500 en el portal o en el webhook de Basecamp escribía la ruta con el token o el secreto.
describe('errores sin secretos en el log', () => {
  it('la ruta del 500 va redactada', async () => {
    // Variables de prueba: en CI no hay backend/.env y la app las valida al crearse.
    vi.stubEnv('SUPABASE_URL', 'https://prueba.supabase.co');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon-prueba');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-prueba');
    const { createApp } = await import('../app');
    const escrito = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = createApp() as unknown as Hono;
    app.get('/api/portal/:token/boom', () => {
      throw new DbError('fallo de prueba', 500);
    });
    await app.request('/api/portal/tok_secreto_123/boom');
    const texto = escrito.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
    expect(texto).not.toContain('tok_secreto_123');
    expect(redactarRuta('/api/portal/tok_secreto_123/boom')).toBe('/api/portal/[redactado]/boom');
  });
});
