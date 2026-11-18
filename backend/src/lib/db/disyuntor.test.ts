import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseEnPausa, fetchConDisyuntor, reiniciarDisyuntor } from './disyuntor';

const REST = 'https://x.supabase.co/rest/v1/requerimientos?select=id';
const AUTH = 'https://x.supabase.co/auth/v1/user';
const ok = () => new Response('[]', { status: 200 });
const sinPool = () =>
  new Response(JSON.stringify({ code: 'PGRST003', message: 'Timed out acquiring connection from connection pool.' }), {
    status: 503,
  });

describe('disyuntor de la base', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reiniciarDisyuntor();
  });
  afterEach(() => vi.useRealTimers());

  it('deja pasar todo mientras la base responde', async () => {
    const base = vi.fn(async () => ok());
    const f = fetchConDisyuntor(base);
    expect((await f(REST)).status).toBe(200);
    expect((await f(REST)).status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
    expect(baseEnPausa()).toBe(false);
  });

  it('con PGRST003 abre el circuito: responde 504 al instante y no vuelve a llamar a la base', async () => {
    const base = vi.fn(async () => sinPool());
    const f = fetchConDisyuntor(base);
    const r = await f(REST);
    expect(r.status).toBe(504); // 504: postgrest-js no lo reintenta
    expect(((await r.json()) as { code: string }).code).toBe('PGRST003');
    expect(baseEnPausa()).toBe(true);
    await f(REST);
    await f(AUTH);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('un error de red en una consulta también abre el circuito', async () => {
    const f = fetchConDisyuntor(async () => {
      throw new TypeError('fetch failed');
    });
    expect((await f(REST)).status).toBe(504);
    expect(baseEnPausa()).toBe(true);
  });

  it('un error de la consulta (400, 404) o de auth no abre el circuito', async () => {
    const f = fetchConDisyuntor(async (input) =>
      String(input).includes('/auth/') ? new Response('{}', { status: 503 }) : new Response('{"code":"42P01"}', { status: 404 }),
    );
    await f(REST);
    await f(AUTH);
    expect(baseEnPausa()).toBe(false);
  });

  it('al vencer la pausa pasa una sola prueba; si responde, se cierra', async () => {
    let caida = true;
    const base = vi.fn(async () => (caida ? sinPool() : ok()));
    const f = fetchConDisyuntor(base);
    await f(REST);
    caida = false;
    vi.advanceTimersByTime(15_001);
    expect(baseEnPausa()).toBe(false);
    expect((await f(REST)).status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
    expect((await f(REST)).status).toBe(200);
  });

  it('si la prueba falla, la pausa se duplica', async () => {
    const f = fetchConDisyuntor(async () => sinPool());
    await f(REST); // pausa 15 s
    vi.advanceTimersByTime(15_001);
    await f(REST); // prueba falla: pausa 30 s
    vi.advanceTimersByTime(20_000);
    expect(baseEnPausa()).toBe(true);
    vi.advanceTimersByTime(10_001);
    expect(baseEnPausa()).toBe(false);
  });
});
