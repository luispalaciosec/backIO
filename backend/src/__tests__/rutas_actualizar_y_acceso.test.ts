import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AuthInfo } from '../lib/auth/middleware';

const m = vi.hoisted(() => {
  process.env.SUPABASE_URL = 'https://prueba.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  return {
    actualizar: vi.fn(),
    usuario: vi.fn(),
    ban: vi.fn(),
    salir: vi.fn(),
    audit: vi.fn(),
  };
});
vi.mock('../lib/requerimientos/actualizar', async (orig) => ({ ...(await orig<object>()), actualizarRequerimiento: m.actualizar }));
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

// Desactivar ya no es un PATCH: pasa por la salida, que reparte lo abierto y deja rastro (docs/20-salida.md).
describe('PATCH /admin/usuarios/:id', () => {
  it('no desactiva a nadie (eso es la salida)', async () => {
    const res = await app(sesion('admin')).request('/admin/usuarios/u9', json('PATCH', { activo: false }));
    expect(res.status).toBe(400);
  });
});
