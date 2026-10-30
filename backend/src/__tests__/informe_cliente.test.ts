import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AuthInfo } from '../lib/auth/middleware';

const m = vi.hoisted(() => {
  process.env.SUPABASE_URL = 'https://prueba.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  return { generar: vi.fn(), insertar: vi.fn(), listar: vi.fn(), audit: vi.fn() };
});
vi.mock('../lib/db/clientes', async (orig) => ({
  ...(await orig<object>()),
  getCliente: async () => ({ id: 'tyt', nombre: 'Grupo Torres & Torres' }),
}));
vi.mock('../lib/db/proyectos', async (orig) => ({
  ...(await orig<object>()),
  listProyectos: async () => [{ id: 'p1', nombre: 'Web 2026', fecha_entrega: '2026-12-15', estado: 'en_ejecucion' }],
}));
vi.mock('../lib/db/requerimientos', async (orig) => ({
  ...(await orig<object>()),
  listBacklog: async () => [
    req({
      id: 'a',
      etiqueta_cliente: 'Home aprobada',
      titulo_interno: 'esto está horrible, rehacer',
      estado_operativo: 'completado',
      entregado_el: '2026-10-28',
    }),
    req({
      id: 'b',
      etiqueta_cliente: null,
      visible_cliente: false,
      titulo_interno: 'Ajuste interno',
      estado_operativo: 'completado',
      entregado_el: '2026-10-29',
    }),
    req({ id: 'c', etiqueta_cliente: 'Landing', titulo_interno: 'Landing v3', fecha_entrega: '2026-11-05' }),
    req({ id: 'd', etiqueta_cliente: 'Fotos de producto', estado_aprobacion: 'pendiente_cliente', fecha_entrega: '2026-10-20' }),
  ],
}));
vi.mock('../lib/db/admin', async (orig) => ({ ...(await orig<object>()), usuarioDelTenant: async () => ({ nombre: 'Grace Franco' }) }));
vi.mock('../lib/db/informes_cliente', () => ({
  insertInformeCliente: m.insertar,
  listInformesCliente: m.listar,
  updateInformeCliente: vi.fn(),
}));
vi.mock('../lib/ia', async (orig) => ({ ...(await orig<object>()), generarJson: m.generar, iaDisponible: () => true }));
vi.mock('../lib/db/audit', () => ({ audit: m.audit }));

function req(p: Record<string, unknown>) {
  return {
    proyecto_id: 'p1',
    visible_cliente: true,
    peso: 1,
    estado_operativo: 'en_ejecucion',
    estado_aprobacion: 'no_aplica',
    fecha_entrega: '2026-10-27',
    ultima_actualizacion: '2026-10-25T15:00:00Z',
    completado_at: null,
    entregado_el: null,
    ...p,
  };
}

const { generarInformeCliente, rangoInforme } = await import('../lib/clientes/informe');
const { clientes } = await import('../routes/v1/clientes');

const sesion = (rol: string): AuthInfo =>
  ({
    tipo: 'usuario',
    rol,
    scopes: [],
    nombre: 'x',
    perfil: 'sesion',
    ctx: { db: {}, tenantId: 't', usuarioId: 'grace', origen: 'ui' },
  }) as never;
function app(rol: string) {
  const a = new Hono();
  a.use('*', async (c, next) => {
    c.set('auth', sesion(rol));
    await next();
  });
  a.route('/clientes', clientes);
  return a;
}

// docs/21 · Informe para el cliente (Fase 3 de las mejoras, 30/10/2026).
describe('Informe para el cliente', () => {
  beforeEach(() => {
    m.generar.mockReset().mockResolvedValue({ asunto: 'Informe semanal', cuerpo: 'Hola' });
    m.insertar.mockReset().mockImplementation(async (_ctx, x) => ({ id: 'i1', ...x }));
  });

  it('el periodo semanal son los últimos 7 días; el mensual, el mes pedido hasta hoy', () => {
    expect(rangoInforme('semanal', '2026-10-30')).toEqual({ desde: '2026-10-24', hasta: '2026-10-30' });
    expect(rangoInforme('mensual', '2026-10-30')).toEqual({ desde: '2026-10-01', hasta: '2026-10-30' });
    expect(rangoInforme('mensual', '2026-11-03', '2026-10')).toEqual({ desde: '2026-10-01', hasta: '2026-10-31' });
  });

  it('la IA recibe solo etiquetas para el cliente: nunca títulos internos ni lo oculto', async () => {
    await generarInformeCliente({ db: {}, tenantId: 't', usuarioId: 'grace' } as never, 'tyt', 'semanal', { hoy: '2026-10-30' });
    const payload = m.generar.mock.calls[0]![1].payload;
    const json = JSON.stringify(payload);
    expect(json).not.toContain('horrible');
    expect(json).not.toContain('Ajuste interno');
    expect(json).not.toContain('Landing v3');
    expect(json).not.toContain('titulo_interno');
    expect(payload.proyectos).toEqual([
      {
        nombre: 'Web 2026',
        avance: 33, // renormalizado sobre lo visible: la tarea oculta no cuenta
        fecha_entrega: '2026-12-15',
        // Los números cuentan todo (la oculta «b» también se entregó); el detalle, solo lo visible.
        entregas: 2,
        proximas: 1,
        esperando: 1,
        espera_max_dias: 5,
        entregado: [{ titulo: 'Home aprobada', fecha: '2026-10-28' }],
        proximo: [{ titulo: 'Landing', fecha: '2026-11-05' }],
        esperando_cliente: [{ titulo: 'Fotos de producto', dias: expect.any(Number) }],
      },
    ]);
    expect(payload.firma).toBe('Grace Franco');
    // Lo guardado es lo mismo que recibió la IA.
    expect(m.insertar.mock.calls[0]![1].datos).toBe(payload);
  });

  it('un colaborador no puede ver ni generar informes (403)', async () => {
    const a = app('colaborador');
    expect((await a.request('/clientes/tyt/informes')).status).toBe(403);
    const r = await a.request('/clientes/tyt/informes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ periodo: 'semanal' }),
    });
    expect(r.status).toBe(403);
    expect(m.generar).not.toHaveBeenCalled();
  });

  it('la ejecutiva lo genera y queda auditado', async () => {
    const r = await app('ejecutiva').request('/clientes/tyt/informes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ periodo: 'mensual', mes: '2026-10' }),
    });
    expect(r.status).toBe(201);
    expect(m.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'informe_cliente_generado' }));
  });
});
