import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReqMantenimiento } from '../lib/db/mantenimiento';

const e = vi.hoisted(() => ({
  reqs: [] as unknown[],
  bajas: vi.fn(),
  enlazar: vi.fn(),
  audit: vi.fn(),
  updateTodo: vi.fn(),
  vivos: new Map<number, { assignees: { id: number }[] }>(),
}));

vi.mock('../lib/db/mantenimiento', () => ({
  requerimientosVivos: async () => e.reqs,
  clientesMantenimiento: async () => [
    { id: 'c1', nombre: 'Cliente Uno', activo: true, basecamp_project_id: 10 },
    { id: 'c2', nombre: 'Cliente Inactivo', activo: false, basecamp_project_id: 20 },
  ],
  idsBasecampDeUsuarios: async () => new Map([['u1', 501]]),
  huerfanosAdoptados: async () => [],
  darDeBajaRequerimientos: e.bajas,
  enlazarConTodo: e.enlazar,
}));
vi.mock('../lib/db', () => ({ audit: e.audit }));
vi.mock('../lib/basecamp/client', () => ({
  BasecampClient: {
    forTenant: async () => ({
      request: async (_m: string, path: string) => e.vivos.get(Number(/todos\/(\d+)/.exec(path)![1])),
      updateTodo: e.updateTodo,
    }),
  },
}));

const {
  aplicar,
  decidirAdoptadosSinEnlace,
  decidirDuplicadosSinEnlace,
  decidirDuplicadosTituloFecha,
  MAX_BASECAMP,
  revisar,
  TopeExcedido,
} = await import('../lib/mantenimiento');

const ctx = { db: {} as never, tenantId: 't', usuarioId: 'admin', origen: 'ui' as const };
const clientes = [
  { id: 'c1', nombre: 'Cliente Uno', activo: true, basecamp_project_id: 10 },
  { id: 'c2', nombre: 'Cliente Inactivo', activo: false, basecamp_project_id: 20 },
];
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
function req(p: Partial<ReqMantenimiento>): ReqMantenimiento {
  return {
    id: uuid(),
    cliente_id: 'c1',
    titulo_interno: 'Post',
    basecamp_todo_id: null,
    estado_operativo: 'backlog',
    created_at: '2026-10-01T10:00:00Z',
    fecha_entrega: '2026-10-20',
    owner_agencia: [],
    ...p,
  };
}

beforeEach(() => {
  e.reqs = [];
  e.vivos.clear();
  vi.clearAllMocks();
});

describe('duplicados por título y fecha', () => {
  it('conserva la enlazada a Basecamp aunque sea la más nueva', () => {
    const vieja = req({ created_at: '2026-09-01T00:00:00Z' });
    const enlazada = req({ basecamp_todo_id: 7, created_at: '2026-10-05T00:00:00Z' });
    const acc = decidirDuplicadosTituloFecha([vieja, enlazada], clientes);
    expect(acc.map((a) => a.id)).toEqual([vieja.id]);
    expect(acc[0]!.datos).toEqual({ conservado: enlazada.id });
  });

  it('sin enlaces, conserva la más antigua; el título se compara sin mayúsculas ni espacios', () => {
    const a = req({ titulo_interno: 'Post ', created_at: '2026-09-01T00:00:00Z' });
    const b = req({ titulo_interno: 'post' });
    expect(decidirDuplicadosTituloFecha([b, a], clientes).map((x) => x.id)).toEqual([b.id]);
  });

  it('nunca toca dos tareas enlazadas a to-dos distintos', () => {
    expect(decidirDuplicadosTituloFecha([req({ basecamp_todo_id: 1 }), req({ basecamp_todo_id: 2 })], clientes)).toEqual([]);
  });

  it('ignora cerradas, fechas distintas y clientes inactivos', () => {
    expect(
      decidirDuplicadosTituloFecha(
        [
          req({}),
          req({ estado_operativo: 'completado' }),
          req({ fecha_entrega: '2026-11-01' }),
          req({ cliente_id: 'c2' }),
          req({ cliente_id: 'c2' }),
        ],
        clientes,
      ),
    ).toEqual([]);
  });
});

describe('duplicados sin enlace', () => {
  it('da de baja la que no está enlazada si existe la misma enlazada; nunca una completada', () => {
    const enlazada = req({ basecamp_todo_id: 9, fecha_entrega: '2026-10-01' });
    const suelta = req({ titulo_interno: 'POST' });
    const completada = req({ estado_operativo: 'completado' });
    expect(decidirDuplicadosSinEnlace([enlazada, suelta, completada], clientes).map((a) => a.id)).toEqual([suelta.id]);
  });

  it('sin una enlazada no hay nada que hacer', () => {
    expect(decidirDuplicadosSinEnlace([req({}), req({})], clientes)).toEqual([]);
  });
});

describe('adoptados sin enlace', () => {
  it('vuelve a enlazar, o da de baja si otro ya tiene el to-do', () => {
    const solo = req({});
    const repetido = req({});
    const yaEnlazado = req({ basecamp_todo_id: 200 });
    const acc = decidirAdoptadosSinEnlace(
      [solo, repetido, yaEnlazado],
      [
        { id: 'h1', basecamp_todo_id: 100, basecamp_todolist_id: 3, app_url: 'https://3.basecamp.com/x', requerimiento_id: solo.id },
        { id: 'h2', basecamp_todo_id: 200, basecamp_todolist_id: 3, app_url: null, requerimiento_id: repetido.id },
        { id: 'h3', basecamp_todo_id: 300, basecamp_todolist_id: 3, app_url: null, requerimiento_id: 'borrado' },
      ],
      clientes,
    );
    expect(acc.map((a) => [a.id, a.tipo])).toEqual([
      [solo.id, 'enlazar'],
      [repetido.id, 'dar_de_baja'],
    ]);
  });
});

describe('aplicar', () => {
  it('solo ejecuta lo confirmado que sigue apareciendo en la revisión, y lo audita', async () => {
    const vieja = req({ created_at: '2026-09-01T00:00:00Z' });
    const enlazada = req({ basecamp_todo_id: 7 });
    e.reqs = [vieja, enlazada];
    const r = await aplicar(ctx, 'duplicados_titulo_fecha', [vieja.id, enlazada.id]);
    expect(r).toEqual({ aplicadas: 1, omitidas: 1, errores: [] });
    expect(e.bajas).toHaveBeenCalledWith('t', [vieja.id]);
    expect(e.audit).toHaveBeenCalledTimes(1);
    expect(e.audit.mock.calls[0]![1]).toMatchObject({ accion: 'mantenimiento_duplicados_titulo_fecha', entidad_id: vieja.id });
  });

  it('revisar no escribe nada', async () => {
    e.reqs = [req({}), req({})];
    expect(await revisar(ctx, 'duplicados_titulo_fecha')).toHaveLength(1);
    expect(e.bajas).not.toHaveBeenCalled();
    expect(e.audit).not.toHaveBeenCalled();
  });

  it('reenvía responsables solo a to-dos que siguen vacíos en Basecamp', async () => {
    const vacio = req({ basecamp_todo_id: 1, owner_agencia: ['u1'] });
    const conResp = req({ basecamp_todo_id: 2, owner_agencia: ['u1'] });
    const sinMapeo = req({ basecamp_todo_id: 3, owner_agencia: ['u9'] });
    e.reqs = [vacio, conResp, sinMapeo];
    e.vivos.set(1, { assignees: [] });
    e.vivos.set(2, { assignees: [{ id: 501 }] });
    expect((await revisar(ctx, 'asignados_basecamp')).map((a) => a.id)).toEqual([vacio.id]);
    const r = await aplicar(ctx, 'asignados_basecamp', [vacio.id, conResp.id]);
    expect(r).toMatchObject({ aplicadas: 1, omitidas: 1 });
    expect(e.updateTodo).toHaveBeenCalledWith(10, 1, { assignee_ids: [501] });
  });

  it(`no escribe más de ${MAX_BASECAMP} to-dos de Basecamp por vez`, async () => {
    const ids = Array.from({ length: MAX_BASECAMP + 1 }, uuid);
    await expect(aplicar(ctx, 'asignados_basecamp', ids)).rejects.toBeInstanceOf(TopeExcedido);
    expect(e.updateTodo).not.toHaveBeenCalled();
  });
});
