/**
 * Test de integración (docs/06): el endpoint público nunca devuelve campos internos.
 * Mockea lib/db para no requerir Supabase.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
process.env.NODE_ENV = 'test';

vi.mock('../lib/db/client', async (orig) => {
  const mod = await orig<typeof import('../lib/db/client')>();
  return { ...mod, serviceClient: () => ({}) as never };
});
vi.mock('../lib/db/proyectos', () => ({
  getProyectoByPortalToken: async (_c: unknown, token: string) =>
    token === 'a'.repeat(43)
      ? {
          proyecto: { id: 'p1', tenant_id: 't', nombre: 'Campaña Navidad', fecha_entrega: '2099-12-15', cliente_id: 'c1' },
          cliente: { nombre: 'Banco Amazonas', logo_url: null, color_primario: '#0073EA', config: {} },
          requerimientos: [
            { id: 'r1', titulo_interno: 'Ruta creativa v3 - la mala', etiqueta_cliente: null, visible_cliente: false, peso: 10, estado_operativo: 'bloqueado', estado_aprobacion: 'no_aplica', fecha_entrega: '2099-12-01', ultima_actualizacion: new Date().toISOString(), owner_agencia: ['u1'], prioridad: 'alta', basecamp_url: 'https://3.basecamp.com/x' },
            { id: 'r2', titulo_interno: 'Entrega final interna', etiqueta_cliente: 'Entrega', visible_cliente: true, peso: 10, estado_operativo: 'reprogramado', estado_aprobacion: 'pendiente_cliente', fecha_entrega: '2099-12-15', ultima_actualizacion: new Date().toISOString(), owner_agencia: ['u1'], prioridad: 'alta', basecamp_url: 'https://3.basecamp.com/y' },
          ],
        }
      : null,
}));

let app: import('hono').Hono;
beforeAll(async () => {
  const { createApp } = await import('../app');
  app = createApp();
});

describe('portal público', () => {
  it('nunca devuelve campos internos', async () => {
    const res = await app.request(`/api/portal/${'a'.repeat(43)}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    ['titulo_interno', 'owner_agencia', 'basecamp', 'peso', 'prioridad', 'estado_operativo', 'la mala', 'interna', 'reprogramado', 'tenant_id']
      .forEach((campo) => expect(body).not.toContain(campo));
    // "bloqueado_por_cliente" es parte del contrato; lo que no puede aparecer es el ESTADO interno "bloqueado" en un hito.
    expect(body.replace(/bloqueado_por_cliente/g, '')).not.toContain('bloqueado');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    const json = JSON.parse(body);
    expect(json.hitos).toHaveLength(1);
    expect(json.hitos[0]).toMatchObject({ titulo: 'Entrega', estado: 'en_proceso', esperando_cliente: true });
  });

  it('token inválido → 404 sin filtrar nada', async () => {
    const res = await app.request('/api/portal/xyz');
    expect(res.status).toBe(404);
  });

  it('el webhook de PrometIO no queda detrás del auth de /api/v1', async () => {
    // Sin secreto configurado (test) la firma no se exige: debe llegar al handler, no al 401 de requireAuth.
    const res = await app.request('/api/v1/webhooks/prometio', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'no-json' });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('bad json');
  });

  it('el webhook de Basecamp ignora eventos que no son de to-do', async () => {
    const res = await app.request('/api/webhooks/basecamp/cualquiera', { method: 'POST', body: JSON.stringify({ kind: 'comment_created', recording: { id: 1, content: 'HORRIBLE' } }) });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });
});
