import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AuthInfo } from '../lib/auth/middleware';

const m = vi.hoisted(() => {
  process.env.SUPABASE_URL = 'https://prueba.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  return {
    actualizar: vi.fn(),
    quitar: vi.fn(),
    usuario: vi.fn(),
    ban: vi.fn(),
    salir: vi.fn(),
    audit: vi.fn(),
  };
});
vi.mock('../lib/requerimientos/actualizar', async (orig) => ({ ...(await orig<object>()), actualizarRequerimiento: m.actualizar }));
vi.mock('../lib/db/lote', async (orig) => ({ ...(await orig<object>()), quitarAcceso: m.quitar }));
vi.mock('../lib/db/admin', async (orig) => ({ ...(await orig<object>()), usuarioDelTenant: m.usuario }));
vi.mock('../lib/db/audit', () => ({ audit: m.audit }));
vi.mock('../lib/db/client', async (orig) => ({
  ...(await orig<object>()),
  serviceClient: () => ({ auth: { admin: { updateUserById: m.ban, signOut: m.salir } } }),
}));

import { requerimientos } from '../routes/v1/requerimientos';
import { admin } from '../routes/v1/admin';
import { ReglaError } from '../lib/requerimientos/actualizar';

const sesion = (rol: string, usuarioId = 'u1', origen: 'ui' | 'api' = 'ui'): AuthInfo =>
  ({ tipo: 'usuario', rol, scopes: [], nombre: 'x', perfil: 'sesion', ctx: { db: {}, tenantId: 't', usuarioId, origen } }) as never;
function app(auth: AuthInfo) {
  return new Hono()
    .use('*', async (c, next) => {
      c.set('auth', auth);
      await next();
    })
    .route('/requerimientos', requerimientos)
    .route('/admin', admin);
}
const json = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ID = '00000000-0000-4000-8000-0000000000aa';

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.actualizar.mockResolvedValue({ requerimiento: { id: ID }, basecamp_due_on: 'sin_todo' });
  m.usuario.mockResolvedValue({ id: 'u9', nombre: 'Ana', email: 'ana@geeks.ec' });
  m.quitar.mockResolvedValue({
    api_keys_revocadas: 1,
    tokens_oauth_borrados: 2,
    codigos_oauth_borrados: 0,
    tareas_reasignadas: 3,
    recurrencias_reasignadas: 0,
  });
  m.ban.mockResolvedValue({ error: null });
  m.salir.mockResolvedValue({ error: null });
});

// Ola 8: la ruta REST es un adaptador de actualizarRequerimiento (B9): traduce rol y origen, y la regla a HTTP.
describe('PATCH /requerimientos/:id', () => {
  it('colaborador desde la UI: reglas de colaborador y motivo obligatorio', async () => {
    const res = await app(sesion('colaborador')).request(`/requerimientos/${ID}`, json('PATCH', { piezas: 2 }));
    expect(res.status).toBe(200);
    expect(m.actualizar).toHaveBeenCalledWith(expect.anything(), ID, { piezas: 2 }, { colaborador: true, exigirMotivo: true });
  });
  it('API (no UI): el motivo no es obligatorio', async () => {
    await app(sesion('operaciones', 'u1', 'api')).request(`/requerimientos/${ID}`, json('PATCH', { prioridad: 'alta' }));
    expect(m.actualizar).toHaveBeenCalledWith(expect.anything(), ID, { prioridad: 'alta' }, { colaborador: false, exigirMotivo: false });
  });
  it('la regla rota vuelve con su estado y mensaje', async () => {
    m.actualizar.mockRejectedValueOnce(new ReglaError('Solo puedes actualizar las tareas asignadas a ti', 403));
    const res = await app(sesion('colaborador')).request(`/requerimientos/${ID}`, json('PATCH', { piezas: 1 }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Solo puedes actualizar las tareas asignadas a ti' });
  });
  it('un título con salto de línea no llega a la función (S5)', async () => {
    const res = await app(sesion('operaciones')).request(`/requerimientos/${ID}`, json('PATCH', { titulo_interno: 'uno\ndos' }));
    expect(res.status).toBe(400);
    expect(m.actualizar).not.toHaveBeenCalled();
  });
});

// B8: «quitar acceso» llama a la transacción y después a Supabase Auth; informa ambos resultados.
describe('POST /admin/usuarios/:id/quitar-acceso', () => {
  const quitar = (a: AuthInfo, id: string, body: unknown = {}) => app(a).request(`/admin/usuarios/${id}/quitar-acceso`, json('POST', body));

  it('nadie se quita el acceso a sí mismo', async () => {
    expect((await quitar(sesion('admin', 'u9'), 'u9')).status).toBe(422);
    expect(m.quitar).not.toHaveBeenCalled();
  });
  it('solo admin', async () => {
    expect((await quitar(sesion('operaciones'), 'u9')).status).toBe(403);
  });
  it('transacción primero, luego Auth; devuelve lo que se hizo', async () => {
    const res = await quitar(sesion('admin'), 'u9', { reasignar_a: '00000000-0000-4000-8000-0000000000bb' });
    expect(await res.json()).toMatchObject({
      ok: true,
      tareas_reasignadas: 3,
      api_keys_revocadas: 1,
      auth_bloqueado: true,
      auth_error: null,
    });
    expect(m.quitar).toHaveBeenCalledWith(expect.anything(), 'u9', '00000000-0000-4000-8000-0000000000bb');
    expect(m.quitar.mock.invocationCallOrder[0]!).toBeLessThan(m.ban.mock.invocationCallOrder[0]!);
    expect(m.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accion: 'quitar_acceso',
        detalle: expect.objectContaining({ email: 'ana@geeks.ec', tareas_reasignadas: 3 }),
      }),
    );
  });
  it('si Supabase Auth falla, la respuesta lo dice (la persona ya quedó inactiva)', async () => {
    m.ban.mockResolvedValueOnce({ error: { message: 'Auth caído' } });
    expect(await (await quitar(sesion('admin'), 'u9')).json()).toMatchObject({ ok: true, auth_bloqueado: false, auth_error: 'Auth caído' });
  });
  it('si la transacción falla, no se toca Auth', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined); // Hono registra el error no manejado
    m.quitar.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 422 }));
    const res = await quitar(sesion('admin'), 'u9');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(m.ban).not.toHaveBeenCalled();
  });
  it('usuario de otro tenant o inexistente: 404', async () => {
    m.usuario.mockResolvedValueOnce(null);
    expect((await quitar(sesion('admin'), 'u-x')).status).toBe(404);
  });
});
