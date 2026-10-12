import { beforeEach, describe, expect, it, vi } from 'vitest';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SALE = U(1);
const LIDER = U(2);
const OTRA = U(3);
const ADMIN = U(9);

const e = vi.hoisted(() => ({
  tareas: [] as Record<string, unknown>[],
  rpc: vi.fn(),
  audit: vi.fn(),
  ban: vi.fn(),
  signOut: vi.fn(),
  reemplazar: vi.fn(),
  forTenant: vi.fn(),
  usuarios: [] as Record<string, unknown>[],
}));

vi.mock('../lib/db/salida', async (orig) => ({
  ...(await orig<object>()),
  tareasAbiertasDe: async () => e.tareas,
  proyectosParaSalida: async () => [],
  acuerdosPendientesDe: async () => [],
  contarApiKeysDe: async () => 1,
  registrarSalida: e.rpc,
}));
vi.mock('../lib/db/usuarios', () => ({
  listUsuarios: async (_c: unknown, o: { incluirInactivos?: boolean } = {}) =>
    o.incluirInactivos ? e.usuarios : e.usuarios.filter((u) => u.activo),
}));
vi.mock('../lib/db/clientes', () => ({
  listClientes: async () => [
    { id: 'c1', nombre: 'Banco Uno', mesa_id: 'm1', basecamp_project_id: 10 },
    { id: 'c2', nombre: 'Retail Dos', mesa_id: null, basecamp_project_id: null },
  ],
}));
vi.mock('../lib/db/mesas', () => ({ listMesas: async () => [{ id: 'm1', nombre: 'Mesa A', lider_id: LIDER }] }));
vi.mock('../lib/db/recurrencias', () => ({
  listRecurrencias: async () => [
    { id: 'r1', cliente_id: 'c1', nombre_patron: 'Fee {mes}', owner_ejecutiva: OTRA, bloques: [{ owner_id: SALE }] },
    { id: 'r2', cliente_id: 'c1', nombre_patron: 'Otro', owner_ejecutiva: OTRA, bloques: [] },
  ],
}));
vi.mock('../lib/db/audit', () => ({ audit: e.audit }));
vi.mock('../lib/db/client', async (orig) => ({
  ...(await orig<object>()),
  serviceClient: () => ({ auth: { admin: { updateUserById: e.ban, signOut: e.signOut } } }),
}));
vi.mock('../lib/basecamp/write', async (orig) => ({ ...(await orig<object>()), reemplazarResponsableEnTodos: e.reemplazar }));
vi.mock('../lib/basecamp/client', () => ({ BasecampClient: { forTenant: e.forTenant } }));

const { aplicarSalida, inventarioSalida } = await import('../lib/salida');
const ctx = { db: {} as never, tenantId: 't', usuarioId: ADMIN, origen: 'ui' as const };
const tarea = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  titulo_interno: `Tarea ${id}`,
  cliente_id: 'c1',
  proyecto_id: null,
  fecha_entrega: '2099-12-31',
  estado_operativo: 'en_ejecucion',
  owner_agencia: [SALE],
  basecamp_todo_id: null,
  daily_fecha: null,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  e.usuarios = [
    { id: SALE, nombre: 'Ana', rol: 'colaborador', activo: true, basecamp_user_id: 501 },
    { id: LIDER, nombre: 'Luis', rol: 'lider', activo: true, basecamp_user_id: 502 },
    { id: OTRA, nombre: 'Carla', rol: 'ejecutiva', activo: true, basecamp_user_id: null },
    { id: ADMIN, nombre: 'Admin', rol: 'admin', activo: true, basecamp_user_id: null },
  ];
  e.tareas = [];
  e.rpc.mockResolvedValue({ tareas: 0, proyectos: 0, mesas: 0, acuerdos: 0, recurrencias: 0, api_keys_revocadas: 0 });
  e.ban.mockResolvedValue({ error: null });
  e.signOut.mockResolvedValue({ error: null });
  e.reemplazar.mockResolvedValue({ actualizados: 0, sin_cambios: 0, errores: [] });
  e.forTenant.mockResolvedValue({});
});

const planVacio = { fecha_salida: '2026-10-11', tareas: [], proyectos: [], mesas: [], acuerdos: [], recurrencias: [] };

describe('inventario de salida', () => {
  it('agrupa por cliente y propone al líder de la mesa del cliente', async () => {
    e.tareas = [tarea('a'), tarea('b', { cliente_id: 'c2', owner_agencia: [SALE, OTRA] })];
    const inv = await inventarioSalida(ctx, SALE);
    expect(inv.clientes.map((g) => [g.cliente, g.propuesto, g.tareas.length])).toEqual([
      ['Banco Uno', LIDER, 1],
      ['Retail Dos', null, 1],
    ]);
    expect(inv.clientes[1]!.tareas[0]!.otros_responsables).toEqual(['Carla']);
    expect(inv.recurrencias.map((r) => r.id)).toEqual(['r1']); // responsable de un bloque
    expect(inv.destinos.map((d) => d.id)).not.toContain(SALE);
  });
  it('marca heredada si la entrega está a menos de 3 días hábiles o vencida', async () => {
    e.tareas = [tarea('vencida', { fecha_entrega: '2020-01-01' }), tarea('lejana'), tarea('sin_fecha', { fecha_entrega: null })];
    const t = (await inventarioSalida(ctx, SALE)).clientes[0]!.tareas;
    expect(Object.fromEntries(t.map((x) => [x.id, x.heredada]))).toEqual({ vencida: true, lejana: false, sin_fecha: false });
  });
  it('no deja registrar la propia salida ni la de alguien que ya no está', async () => {
    await expect(inventarioSalida({ ...ctx, usuarioId: SALE }, SALE)).rejects.toMatchObject({ status: 422 });
    e.usuarios[0]!.activo = false;
    await expect(inventarioSalida(ctx, SALE)).rejects.toMatchObject({ status: 422 });
  });
});

describe('aplicar la salida', () => {
  it('una tarea del daily no puede quedar sin responsable', async () => {
    e.tareas = [tarea('a', { daily_fecha: '2026-10-11' })];
    await expect(aplicarSalida(ctx, SALE, { ...planVacio, tareas: [{ id: 'a', a: null }] })).rejects.toMatchObject({ status: 422 });
    expect(e.rpc).not.toHaveBeenCalled();
  });
  it('heredada la calcula el backend y solo cuenta si hay quien la reciba', async () => {
    e.tareas = [tarea('a', { fecha_entrega: '2020-01-01' }), tarea('b', { fecha_entrega: '2020-01-01' }), tarea('c')];
    await aplicarSalida(ctx, SALE, {
      ...planVacio,
      tareas: [
        { id: 'a', a: LIDER },
        { id: 'b', a: null },
        { id: 'c', a: LIDER },
      ],
    });
    expect(e.rpc.mock.calls[0]![2].plan.tareas).toEqual([
      { id: 'a', a: LIDER, heredada: true },
      { id: 'b', a: null, heredada: false },
      { id: 'c', a: LIDER, heredada: false },
    ]);
  });
  it('transacción, luego Auth y Basecamp; auditoría por tarea', async () => {
    e.tareas = [tarea('a', { basecamp_todo_id: 70 }), tarea('b', { cliente_id: 'c2', basecamp_todo_id: 71 })];
    e.reemplazar.mockResolvedValue({ actualizados: 1, sin_cambios: 0, errores: [] });
    const r = await aplicarSalida(ctx, SALE, {
      ...planVacio,
      tareas: [
        { id: 'a', a: LIDER },
        { id: 'b', a: OTRA },
      ],
    });
    expect(e.rpc.mock.invocationCallOrder[0]!).toBeLessThan(e.ban.mock.invocationCallOrder[0]!);
    // Solo el to-do del cliente con proyecto de Basecamp; entra el id de Basecamp del líder.
    expect(e.reemplazar.mock.calls[0]![1]).toEqual([{ requerimientoId: 'a', projectId: 10, todoId: 70, sale: 501, entra: 502 }]);
    expect(r).toMatchObject({ auth_bloqueado: true, auth_error: null, basecamp: { actualizados: 1 } });
    // signOut recibe un JWT, no un id: llamarlo con el id fallaba siempre (prueba en producción del 11/10).
    expect(e.signOut).not.toHaveBeenCalled();
    const acciones = e.audit.mock.calls.map((c) => c[1].accion);
    expect(acciones.filter((a) => a === 'salida_reasignacion')).toHaveLength(2);
    expect(acciones).toContain('salida_colaborador');
  });
  it('si la transacción falla no se toca Auth ni Basecamp', async () => {
    e.tareas = [tarea('a', { basecamp_todo_id: 70 })];
    e.rpc.mockRejectedValueOnce(Object.assign(new Error('El plan no cubre todas sus tareas'), { status: 422 }));
    await expect(aplicarSalida(ctx, SALE, { ...planVacio, tareas: [{ id: 'a', a: LIDER }] })).rejects.toThrow(/no cubre/);
    expect(e.ban).not.toHaveBeenCalled();
    expect(e.reemplazar).not.toHaveBeenCalled();
  });
  it('si Basecamp no responde, BackIO queda bien y la respuesta lista los pendientes', async () => {
    e.tareas = [tarea('a', { basecamp_todo_id: 70 })];
    e.forTenant.mockRejectedValueOnce(new Error('Basecamp desconectado'));
    const r = await aplicarSalida(ctx, SALE, { ...planVacio, tareas: [{ id: 'a', a: LIDER }] });
    expect(r.basecamp.errores).toEqual([{ requerimientoId: 'a', error: 'Basecamp desconectado' }]);
  });
  it('parte los to-dos de Basecamp en lotes de 50', async () => {
    e.tareas = Array.from({ length: 120 }, (_, i) => tarea(`t${i}`, { basecamp_todo_id: 1000 + i }));
    await aplicarSalida(ctx, SALE, { ...planVacio, tareas: e.tareas.map((t) => ({ id: t.id as string, a: LIDER })) });
    expect(e.reemplazar.mock.calls.map((c) => c[1].length)).toEqual([50, 50, 20]);
  });
});
