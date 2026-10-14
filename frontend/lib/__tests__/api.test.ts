import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabase/client', () => ({
  supabaseBrowser: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'jwt-prueba' } } }) } }),
}));

import { api, apiPortal, ApiError, descargar, mensajeDeError, pedir } from '../api';

const respuesta = (status: number, cuerpo?: unknown, crudo?: string) =>
  new Response(crudo ?? (cuerpo === undefined ? null : JSON.stringify(cuerpo)), { status });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

// Ola 8: primeros tests del frontend. El núcleo de fetch (Ola 5) y los mensajes de error (B3).
describe('mensajeDeError', () => {
  it('usa el texto del backend', () => expect(mensajeDeError({ error: 'Cliente no encontrado' }, 404)).toBe('Cliente no encontrado'));
  it('entiende el formato viejo de zod (objeto con issues)', () =>
    expect(mensajeDeError({ error: { issues: [{ path: ['fecha_entrega'] }, { path: ['piezas'] }, { path: ['piezas'] }] } }, 400)).toBe(
      'Revisa: fecha_entrega, piezas',
    ));
  it('mensajes claros para sesión vencida y fallas del servidor', () => {
    expect(mensajeDeError(undefined, 401)).toBe('Tu sesión expiró. Vuelve a ingresar.');
    expect(mensajeDeError({}, 502)).toMatch(/servidor/);
    expect(mensajeDeError(null, 418)).toBe('Error 418');
  });
});

describe('pedir', () => {
  it('204 devuelve undefined', async () => {
    fetchMock.mockResolvedValue(respuesta(204));
    expect(await pedir('https://x/api')).toBeUndefined();
  });
  it('un 2xx que no es JSON falla en vez de devolver {} disfrazado', async () => {
    fetchMock.mockResolvedValue(respuesta(200, undefined, '<html>proxy</html>'));
    await expect(pedir('https://x/api')).rejects.toThrow('Respuesta inesperada del servidor');
  });
  it('un error conserva estado, mensaje y detalle', async () => {
    fetchMock.mockResolvedValue(respuesta(400, { error: 'Revisa: piezas', detalle: [{ campo: 'piezas' }] }));
    const e = await pedir('https://x/api').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 400, message: 'Revisa: piezas', detalle: [{ campo: 'piezas' }] });
  });
  it('json va serializado con su cabecera', async () => {
    fetchMock.mockResolvedValue(respuesta(200, { ok: true }));
    await pedir('https://x/api', { method: 'POST', json: { a: 1 } });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init).toMatchObject({ method: 'POST', body: '{"a":1}', cache: 'no-store', headers: { 'Content-Type': 'application/json' } });
  });
});

describe('envoltorios', () => {
  it('api agrega el token de la sesión y el prefijo /api/v1', async () => {
    fetchMock.mockResolvedValue(respuesta(200, { items: [] }));
    await api('/clientes');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/v1\/clientes$/);
    expect(init.headers).toMatchObject({ Authorization: 'Bearer jwt-prueba' });
  });
  it('apiPortal no manda token y sí el PIN', async () => {
    fetchMock.mockResolvedValue(respuesta(200, {}));
    await apiPortal('/tok', {}, '1234');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/portal\/tok$/);
    expect(init.headers).toEqual({ 'X-Portal-Pin': '1234' });
  });
});

describe('descargar (CSV)', () => {
  it('si el backend falla, lanza el error y no baja un archivo con el error adentro', async () => {
    fetchMock.mockResolvedValueOnce(respuesta(500, { error: 'Error interno' }));
    const crear = vi.spyOn(URL, 'createObjectURL');
    await expect(descargar('/kpis/export?hasta=2026-10&meses=1', 'kpis.csv')).rejects.toBeInstanceOf(ApiError);
    expect(crear).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer jwt-prueba');
  });
});
