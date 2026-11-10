import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AuthInfo } from '../lib/auth/middleware';

const m = vi.hoisted(() => {
  process.env.SUPABASE_URL = 'https://prueba.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  return { ejecutar: vi.fn(), audit: vi.fn() };
});
vi.mock('../lib/jobs', async (orig) => ({ ...(await orig<object>()), ejecutarJob: m.ejecutar }));
vi.mock('../lib/db/audit', async (orig) => ({ ...(await orig<object>()), audit: m.audit }));
vi.mock('../lib/db', async (orig) => ({ ...(await orig<object>()), audit: m.audit }));

const { admin } = await import('../routes/v1/admin');
const como = (rol: string, scopes: string[] = []) =>
  new Hono()
    .use('*', async (c, next) => {
      c.set('auth', {
        tipo: 'usuario',
        rol,
        scopes,
        nombre: 'X',
        ctx: { db: {}, tenantId: 't', usuarioId: 'u', origen: 'ui' },
      } as unknown as AuthInfo);
      await next();
    })
    .route('/admin', admin);
const post = (app: Hono, nombre: string) => app.request(`/admin/jobs/${nombre}/ejecutar`, { method: 'POST' });

// 9/11/2026: tras la caída de la base hubo que relanzar tareas desde la terminal.
describe('ejecutar una tarea programada desde Admin → Servicios', () => {
  it('la corre a mano, la registra y dice si salió bien', async () => {
    m.ejecutar.mockResolvedValue({ ventana: 'manual:x', resultado: { t: { clientes: 14 } } });
    const r = await post(como('admin'), 'salud_clientes');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, resultado: { t: { clientes: 14 } } });
    expect(m.ejecutar.mock.calls[0]![2]).toEqual({ manual: true });
    expect(m.audit.mock.calls[0]![1]).toMatchObject({ accion: 'ejecutar_job', detalle: { job: 'salud_clientes' } });
  });
  it('si terminó con errores, lo dice', async () => {
    m.ejecutar.mockResolvedValue({ ventana: 'manual:x', resultado: { error: 'falló' } });
    expect(await (await post(como('admin'), 'salud_clientes')).json()).toMatchObject({ ok: false });
  });
  it('una tarea que no existe da 404, y quien no es admin no puede', async () => {
    expect((await post(como('admin'), 'inventada')).status).toBe(404);
    expect((await post(como('ejecutiva'), 'salud_clientes')).status).toBe(403);
  });
});
