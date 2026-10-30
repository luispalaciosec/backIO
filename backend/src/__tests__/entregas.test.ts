import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AuthInfo } from '../lib/auth/middleware';
import { cerradaATiempo, entregaReal, tramosEsperaCliente } from '@backio/shared';

const m = vi.hoisted(() => {
  process.env.SUPABASE_URL = 'https://prueba.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  return {
    req: null as Record<string, unknown> | null,
    update: vi.fn(),
    completar: vi.fn(),
    actualizar: vi.fn(),
    forActor: vi.fn(),
    notificar: vi.fn(),
    audit: vi.fn(),
  };
});
vi.mock('../lib/db/requerimientos', async (orig) => ({
  ...(await orig<object>()),
  getRequerimiento: async () => m.req,
  updateRequerimiento: m.update,
}));
vi.mock('../lib/db/clientes', async (orig) => ({
  ...(await orig<object>()),
  getCliente: async () => ({ id: 'tyt', nombre: 'Grupo Torres & Torres', ejecutiva_id: 'grace' }),
}));
vi.mock('../lib/db/audit', () => ({ audit: m.audit }));
vi.mock('../lib/basecamp/write', async (orig) => ({ ...(await orig<object>()), completarTodo: m.completar }));
vi.mock('../lib/basecamp/client', async (orig) => {
  const o = await orig<typeof import('../lib/basecamp/client')>();
  return { ...o, BasecampClient: { ...o.BasecampClient, forActor: m.forActor } };
});
vi.mock('../lib/requerimientos/actualizar', async (orig) => ({ ...(await orig<object>()), actualizarRequerimiento: m.actualizar }));
vi.mock('../lib/notificaciones', async (orig) => ({ ...(await orig<object>()), notificar: m.notificar }));

const { requerimientos } = await import('../routes/v1/requerimientos');
const { BasecampSinConectar } = await import('../lib/basecamp/client');
const { DbError } = await import('../lib/db/client');
const { debePreguntarse } = await import('../lib/entregas');

const sesion = (rol: string, usuarioId = 'oscar'): AuthInfo =>
  ({ tipo: 'usuario', rol, scopes: [], nombre: 'x', perfil: 'sesion', ctx: { db: {}, tenantId: 't', usuarioId, origen: 'ui' } }) as never;
// Como en app.ts: un DbError (p. ej. BasecampSinConectar, 428) sale con su estado.
const app = (a: AuthInfo) => {
  const h = new Hono()
    .use('*', async (c, next) => {
      c.set('auth', a);
      await next();
    })
    .route('/requerimientos', requerimientos);
  h.onError((err, c) => (err instanceof DbError ? c.json({ error: err.message }, err.status as 428) : c.json({ error: 'x' }, 500)));
  return h;
};
const responder = (a: AuthInfo, body: unknown) =>
  app(a).request('/requerimientos/r1/entrega', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  Object.values(m).forEach((f) => typeof f === 'function' && f.mockReset());
  m.req = {
    id: 'r1',
    cliente_id: 'tyt',
    titulo_interno: 'Cronograma octubre',
    owner_agencia: ['oscar'],
    estado_operativo: 'en_ejecucion',
    fecha_pedido: '2026-09-25',
    created_at: '2026-09-25T15:00:00Z',
    basecamp_todo_id: 123,
  };
  m.forActor.mockResolvedValue({});
  m.completar.mockResolvedValue(true);
});

describe('«¿ya se entregó?»', () => {
  it('se pregunta por lo atrasado y quieto, no por lo que espera al cliente ni lo ya declarado', () => {
    const base = { dias_atraso: 5, dias_sin_movimiento: 3, estado_aprobacion: 'no_aplica' as const, entregado_el: null };
    expect(debePreguntarse(base)).toBe(true);
    expect(debePreguntarse({ ...base, dias_sin_movimiento: 1 })).toBe(false);
    expect(debePreguntarse({ ...base, estado_aprobacion: 'pendiente_cliente' as const })).toBe(false);
    expect(debePreguntarse({ ...base, entregado_el: '2026-10-01' })).toBe(false);
  });
  it('«sí, el día X»: guarda la fecha y completa en Basecamp con la cuenta de quien responde; no completa en BackIO', async () => {
    const res = await responder(sesion('colaborador'), { respuesta: 'entregado', fecha: '2026-10-01' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ respuesta: 'entregado', basecamp: 'completado' });
    expect(m.update).toHaveBeenCalledWith(
      expect.anything(),
      'r1',
      expect.objectContaining({ entregado_el: '2026-10-01', entregado_por: 'oscar' }),
    );
    expect(m.completar).toHaveBeenCalledTimes(1);
    expect(m.actualizar).not.toHaveBeenCalled();
  });
  it('sin Basecamp conectado no guarda nada (428)', async () => {
    m.forActor.mockRejectedValue(new BasecampSinConectar());
    const res = await responder(sesion('colaborador'), { respuesta: 'entregado', fecha: '2026-10-01' });
    expect(res.status).toBe(428);
    expect(m.update).not.toHaveBeenCalled();
  });
  it('fecha futura o anterior al pedido: 422; quien no es responsable ni de gestión: 403', async () => {
    expect((await responder(sesion('colaborador'), { respuesta: 'entregado', fecha: '2099-01-01' })).status).toBe(422);
    expect((await responder(sesion('colaborador'), { respuesta: 'entregado', fecha: '2026-09-01' })).status).toBe(422);
    expect((await responder(sesion('colaborador', 'otra'), { respuesta: 'espera_cliente' })).status).toBe(403);
    expect((await responder(sesion('operaciones', 'marcia'), { respuesta: 'espera_cliente' })).status).toBe(200);
  });
  it('«espera al cliente»: pasa a pendiente del cliente y avisa a la ejecutiva de la cuenta', async () => {
    await responder(sesion('colaborador'), { respuesta: 'espera_cliente' });
    expect(m.update).toHaveBeenCalledWith(expect.anything(), 'r1', { estado_aprobacion: 'pendiente_cliente' });
    expect(m.notificar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ruta: '/clientes/tyt' }), {
      usuarioIds: ['grace'],
    });
  });
  it('sin to-do enlazado se completa en BackIO', async () => {
    m.req = { ...m.req!, basecamp_todo_id: null };
    const r = await (await responder(sesion('colaborador'), { respuesta: 'entregado', fecha: '2026-10-01' })).json();
    expect(r).toEqual({ respuesta: 'entregado', basecamp: 'sin_todo' });
    expect(m.actualizar).toHaveBeenCalledWith(expect.anything(), 'r1', { estado_operativo: 'completado' }, expect.anything());
  });
});

describe('a tiempo con la entrega declarada', () => {
  it('entregada el 1/10 y cerrada en Basecamp el 15/10, con fecha 2/10: a tiempo', () => {
    const r = { completado_at: '2026-10-15T15:00:00Z', entregado_el: '2026-10-01' };
    expect(cerradaATiempo(entregaReal(r), '2026-10-02')).toBe(true);
    expect(cerradaATiempo(entregaReal({ ...r, entregado_el: null }), '2026-10-02')).toBe(false);
  });
});

describe('cuánto tarda el cliente en responder', () => {
  it('cuenta desde que entra a «pendiente del cliente» hasta que sale; sin salida, sigue abierto', () => {
    const t = tramosEsperaCliente(
      [
        { requerimiento_id: 'a', estado_de: 'no_aplica', estado_a: 'pendiente_cliente', created_at: '2026-10-01T15:00:00Z' },
        { requerimiento_id: 'a', estado_de: 'pendiente_cliente', estado_a: 'aprobado', created_at: '2026-10-04T15:00:00Z' },
        { requerimiento_id: 'b', estado_de: 'no_aplica', estado_a: 'pendiente_cliente', created_at: '2026-10-20T15:00:00Z' },
      ],
      new Date('2026-10-30T15:00:00Z'),
    );
    expect(t).toEqual([
      { requerimiento_id: 'a', desde: '2026-10-01T15:00:00Z', hasta: '2026-10-04T15:00:00Z', dias: 3 },
      { requerimiento_id: 'b', desde: '2026-10-20T15:00:00Z', hasta: null, dias: 10 },
    ]);
  });
});
