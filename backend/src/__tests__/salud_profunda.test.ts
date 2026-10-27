import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';

const { saludProfunda, limpiarCacheSalud, LIMITE_BASE_MS } = await import('../lib/salud');

const AHORA = Date.parse('2026-10-27T18:30:00Z');
const hace = (min: number) => new Date(AHORA - min * 60_000).toISOString();
const deps = (o: { base?: () => Promise<void>; ultima?: string | null } = {}) => ({
  pingBase: vi.fn(o.base ?? (async () => undefined)),
  ultimaCorridaDe: vi.fn(async () => (o.ultima === undefined ? hace(10) : o.ultima)),
});

beforeEach(() => {
  limpiarCacheSalud();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

// Caída del 27/10/2026: /health decía «ok» mientras la API de la base no daba conexiones (PGRST003) durante 14 horas.
describe('chequeo profundo de salud', () => {
  it('todo bien: la base responde y la reconciliación corrió hace poco', async () => {
    expect(await saludProfunda(AHORA, deps())).toMatchObject({ ok: true, base: 'ok', tareas: 'ok' });
  });
  it('la base no responde: falla (lo que vio el monitor externo el 27/10)', async () => {
    const r = await saludProfunda(AHORA, deps({ base: async () => Promise.reject(new Error('Timed out acquiring connection')) }));
    expect(r).toMatchObject({ ok: false, base: 'caida' });
  });
  it('la base se cuelga: corta en el límite de tiempo y falla', async () => {
    vi.useFakeTimers();
    const p = saludProfunda(AHORA, deps({ base: () => new Promise(() => undefined) }));
    await vi.advanceTimersByTimeAsync(LIMITE_BASE_MS + 10);
    expect(await p).toMatchObject({ ok: false, base: 'caida' });
    vi.useRealTimers();
  });
  it('la reconciliación lleva más de 75 min sin correr: falla', async () => {
    expect(await saludProfunda(AHORA, deps({ ultima: hace(90) }))).toMatchObject({ ok: false, base: 'ok', tareas: 'atrasadas' });
    limpiarCacheSalud();
    expect(await saludProfunda(AHORA, deps({ ultima: null }))).toMatchObject({ ok: false, tareas: 'atrasadas' });
  });
  it('guarda el resultado 30 s para no cargar la base con el monitor', async () => {
    const d = deps();
    await saludProfunda(AHORA, d);
    await saludProfunda(AHORA + 20_000, d);
    expect(d.pingBase).toHaveBeenCalledTimes(1);
    await saludProfunda(AHORA + 31_000, d);
    expect(d.pingBase).toHaveBeenCalledTimes(2);
  });
  it('no expone detalles internos', async () => {
    const r = await saludProfunda(AHORA, deps({ base: async () => Promise.reject(new Error('secreto interno')) }));
    expect(JSON.stringify(r)).not.toContain('secreto');
  });
});
