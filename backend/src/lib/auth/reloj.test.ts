import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchConRelojTolerante, firmarRespaldo, hayDesfase, marcarTokenVerificado, reiniciarReloj } from './reloj';

const CLAVE = 'clave-de-prueba';
const REST = 'https://x.supabase.co/rest/v1/usuarios?select=id';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const ahoraS = () => Math.floor(Date.now() / 1000);
const tokenUsuario = (extra: Record<string, unknown> = {}) =>
  `${b64({ alg: 'ES256', kid: 'k1' })}.${b64({ sub: 'u1', role: 'authenticated', aud: 'authenticated', iat: ahoraS() + 90, exp: ahoraS() + 3600, ...extra })}.firma`;
const payload = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString()) as Record<string, unknown>;
const enviado = (f: ReturnType<typeof vi.fn>, i: number) =>
  new Headers((f.mock.calls[i]![1] as RequestInit).headers).get('authorization')!.slice(7);
const futuro = () => new Response('{"code":"PGRST303","message":"JWT issued at future"}', { status: 401 });

describe('plan B: reloj desfasado de Supabase', () => {
  beforeEach(() => {
    reiniciarReloj();
    process.env.SUPABASE_JWT_SECRET = CLAVE;
  });
  afterEach(() => {
    delete process.env.SUPABASE_JWT_SECRET;
  });

  it('el token de respaldo conserva usuario y rol, se emite en el pasado, vence pronto y va firmado con HS256', () => {
    const t = firmarRespaldo(tokenUsuario({ email: 'a@b.c' }), CLAVE)!;
    const [h, p, firma] = t.split('.');
    expect(JSON.parse(Buffer.from(h!, 'base64url').toString())).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(firma).toBe(createHmac('sha256', CLAVE).update(`${h}.${p}`).digest('base64url'));
    const c = payload(t);
    expect(c).toMatchObject({ sub: 'u1', role: 'authenticated', aud: 'authenticated', email: 'a@b.c' });
    expect(c.iat as number).toBeLessThan(ahoraS() - 60);
    expect(c.exp as number).toBeLessThanOrEqual(ahoraS() + 300);
  });

  it('no firma claves de servicio ni anónimas', () => {
    expect(firmarRespaldo(`${b64({})}.${b64({ role: 'service_role' })}.x`, CLAVE)).toBeNull();
    expect(firmarRespaldo(`${b64({})}.${b64({ role: 'anon' })}.x`, CLAVE)).toBeNull();
  });

  it('con PGRST303 reintenta con el token de respaldo y lo sigue usando mientras dure el desfase', async () => {
    const jwt = tokenUsuario();
    marcarTokenVerificado(jwt, Date.now() + 3_600_000);
    const base = vi.fn(async (_i: unknown, init?: RequestInit) =>
      new Headers(init?.headers).get('authorization') === `Bearer ${jwt}` ? futuro() : new Response('[]', { status: 200 }),
    );
    const f = fetchConRelojTolerante(base as unknown as typeof fetch);
    const r = await f(REST, { headers: { Authorization: `Bearer ${jwt}` } });
    expect(r.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
    expect(payload(enviado(base, 1)).sub).toBe('u1');
    expect(hayDesfase()).toBe(true);
    await f(REST, { headers: { Authorization: `Bearer ${jwt}` } });
    expect(base).toHaveBeenCalledTimes(3); // ya no prueba primero con el token original
    expect(enviado(base, 2)).not.toBe(jwt);
  });

  it('nunca firma un token que Auth no verificó', async () => {
    const jwt = tokenUsuario({ sub: 'admin-falso' });
    const base = vi.fn(async () => futuro());
    const r = await fetchConRelojTolerante(base as unknown as typeof fetch)(REST, { headers: { Authorization: `Bearer ${jwt}` } });
    expect(r.status).toBe(401);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('sin SUPABASE_JWT_SECRET no hace nada', async () => {
    delete process.env.SUPABASE_JWT_SECRET;
    const jwt = tokenUsuario();
    marcarTokenVerificado(jwt, Date.now() + 3_600_000);
    const base = vi.fn(async () => futuro());
    const r = await fetchConRelojTolerante(base as unknown as typeof fetch)(REST, { headers: { Authorization: `Bearer ${jwt}` } });
    expect(r.status).toBe(401);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('otros 401 (permisos, token vencido) no activan el respaldo', async () => {
    const jwt = tokenUsuario();
    marcarTokenVerificado(jwt, Date.now() + 3_600_000);
    const base = vi.fn(async () => new Response('{"code":"PGRST301","message":"JWT expired"}', { status: 401 }));
    const r = await fetchConRelojTolerante(base as unknown as typeof fetch)(REST, { headers: { Authorization: `Bearer ${jwt}` } });
    expect(r.status).toBe(401);
    expect(base).toHaveBeenCalledTimes(1);
    expect(hayDesfase()).toBe(false);
  });
});
