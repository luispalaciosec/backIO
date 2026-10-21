import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
process.env.BASECAMP_ACCOUNT_ID = '1';
process.env.BASECAMP_CLIENT_ID = 'id';
process.env.BASECAMP_CLIENT_SECRET = 'secreto-de-prueba';

const e = vi.hoisted(() => ({ borrar: vi.fn(), actualizar: vi.fn() }));
const tokens = { access_token: 'a', refresh_token: 'r', expires_at: '2099-01-01T00:00:00Z' };
vi.mock('../lib/db/credenciales', () => ({
  leerCredencialesPersona: async () => ({ ...tokens, email: 'grace@geeks.ec' }),
  leerCredencialesBasecamp: async () => tokens,
  borrarCredencialesPersona: e.borrar,
  actualizarTokensPersona: e.actualizar,
}));

import { BasecampClient, BasecampSinConectar } from '../lib/basecamp/client';

const respuesta = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  e.borrar.mockReset();
  e.actualizar.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.unstubAllGlobals());

// 19/10/2026: Basecamp invalidó el token de Grace («rekeyed_identity») y cada cambio fallaba sin que nadie lo supiera.
describe('Basecamp rechaza el token de una persona (401)', () => {
  it('se renueva con el refresh y se repite la petición', async () => {
    fetchMock
      .mockResolvedValueOnce(respuesta(401, { error: 'OAuth token expired (rekeyed_identity)' }))
      .mockResolvedValueOnce(respuesta(200, { access_token: 'nuevo', expires_in: 1209600 }))
      .mockResolvedValueOnce(respuesta(200, { id: 42 }));
    const bc = (await BasecampClient.forResponsable('t', 'grace'))!;
    await expect(bc.request('GET', '/buckets/1/todos/42.json')).resolves.toEqual({ id: 42 });
    expect(e.actualizar).toHaveBeenCalled();
    expect(e.borrar).not.toHaveBeenCalled();
  });
  it('si el refresh no sirve, se borra su conexión y se le pide conectar otra vez (428)', async () => {
    fetchMock.mockResolvedValueOnce(respuesta(401)).mockResolvedValueOnce(respuesta(400));
    const bc = (await BasecampClient.forResponsable('t', 'grace'))!;
    await expect(bc.request('GET', '/buckets/1/todos/42.json')).rejects.toBeInstanceOf(BasecampSinConectar);
    expect(e.borrar).toHaveBeenCalledWith('grace');
  });
  it('si tras renovar Basecamp sigue rechazando, también se borra la conexión', async () => {
    fetchMock
      .mockResolvedValueOnce(respuesta(401))
      .mockResolvedValueOnce(respuesta(200, { access_token: 'nuevo', expires_in: 1209600 }))
      .mockResolvedValueOnce(respuesta(401));
    const bc = (await BasecampClient.forResponsable('t', 'grace'))!;
    await expect(bc.request('GET', '/x.json')).rejects.toBeInstanceOf(BasecampSinConectar);
    expect(e.borrar).toHaveBeenCalledWith('grace');
  });
});
