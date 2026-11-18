import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const getUser = vi.fn();
const getUsuarioSesion = vi.fn();

vi.mock('../db/client', async (orig) => ({
  ...(await orig<typeof import('../db/client')>()),
  userClient: () => ({ auth: { getUser } }),
}));
vi.mock('../db/auth', () => ({
  getUsuarioSesion: (...a: unknown[]) => getUsuarioSesion(...a),
  getApiKeyPorHash: vi.fn(),
  getUsuarioOAuth: vi.fn(),
  registrarUsoApiKey: vi.fn(),
}));

const { requireAuth, olvidarSesiones } = await import('./middleware');

const app = new Hono();
app.use('*', requireAuth);
app.get('/yo', (c) => c.json({ rol: c.get('auth').rol }));

const token = (expSeg: number) =>
  `x.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSeg })).toString('base64url')}.y`;
const pedir = (jwt: string) => app.request('/yo', { headers: { authorization: `Bearer ${jwt}` } });

describe('caché de sesiones', () => {
  beforeEach(() => {
    olvidarSesiones();
    getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    getUsuarioSesion.mockReset().mockResolvedValue({ tenant_id: 't1', rol: 'ejecutiva', nombre: 'Prueba', activo: true });
  });

  it('valida la sesión una vez por minuto, no en cada petición', async () => {
    const jwt = token(3600);
    expect((await pedir(jwt)).status).toBe(200);
    expect((await pedir(jwt)).status).toBe(200);
    expect(await (await pedir(jwt)).json()).toEqual({ rol: 'ejecutiva' });
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(getUsuarioSesion).toHaveBeenCalledTimes(1);
  });

  it('no recuerda un token que ya vence', async () => {
    const jwt = token(-10);
    await pedir(jwt);
    await pedir(jwt);
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it('un cambio de usuario (rol o baja) rige en la petición siguiente', async () => {
    const jwt = token(3600);
    await pedir(jwt);
    getUsuarioSesion.mockResolvedValue({ tenant_id: 't1', rol: 'ejecutiva', nombre: 'Prueba', activo: false });
    olvidarSesiones();
    expect((await pedir(jwt)).status).toBe(401);
  });

  it('una sesión rechazada no se recuerda', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid JWT', status: 401 } });
    const jwt = token(3600);
    expect((await pedir(jwt)).status).toBe(401);
    expect((await pedir(jwt)).status).toBe(401);
    expect(getUser).toHaveBeenCalledTimes(2);
  });
});
