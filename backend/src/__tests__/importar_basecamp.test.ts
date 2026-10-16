import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TodoPlano } from '../lib/basecamp/recorrer';

const estado = vi.hoisted(() => ({
  insertados: [] as { basecamp_todo_id: number; titulo_interno: string; clase?: string }[],
  duplicados: new Set<number>(),
  enlazados: [] as unknown[],
  ignorados: new Set<number>(),
  todos: [] as unknown[],
  vivo: { status: 'active' } as Record<string, unknown>,
  conElNuevo: null as { id: string; deleted_at: string | null } | null,
  actualizar: vi.fn(),
}));

vi.mock('../lib/db/clientes', () => ({
  getCliente: async () => ({ id: 'c1', basecamp_project_id: 10 }),
  clientePorProyectoBasecamp: async (b: number) => ({ id: `c-de-${b}`, tenant_id: 't', nombre: `Cliente ${b}` }),
}));
vi.mock('../lib/db/huerfanos', () => ({ getRequerimientoPorTodo: async () => estado.conElNuevo }));
vi.mock('../lib/db/usuarios', () => ({ listUsuarios: async () => [{ id: 'u1', basecamp_user_id: 501 }] }));
vi.mock('../lib/db/proyectos', () => ({
  insertProyecto: async () => ({ id: 'p-nuevo' }),
  updateProyecto: async () => undefined,
}));
vi.mock('../lib/db/audit', () => ({ audit: async () => undefined }));
vi.mock('../lib/db/basecamp_import', () => ({
  proyectosDeCliente: async () => [{ id: 'p1', nombre: 'Lista', basecamp_todolist_id: 100, basecamp_grupos: {} }],
  enlazadosDeCliente: async () => estado.enlazados,
  todosIgnorados: async () => estado.ignorados,
  insertarEnlazado: async (_c: unknown, fila: { basecamp_todo_id: number; titulo_interno: string }) => {
    if (estado.duplicados.has(fila.basecamp_todo_id)) return null;
    // Simula el trabajo de red: la carrera entre dos importaciones ocurre aquí.
    await new Promise((r) => setTimeout(r, 5));
    if (estado.insertados.some((x) => x.basecamp_todo_id === fila.basecamp_todo_id)) return null;
    estado.insertados.push(fila);
    return { id: `r${fila.basecamp_todo_id}` };
  },
  actualizarEnlazado: estado.actualizar,
  marcarHuerfanosAdoptados: async () => undefined,
  marcarClienteImportado: async () => undefined,
}));
vi.mock('../lib/basecamp/client', () => ({
  BasecampClient: {
    forTenant: async () => ({
      getTodosetId: async () => 1,
      listTodolists: async () => [{ id: 100, name: 'Lista' }],
      listGroups: async () => [],
      listTodosSafe: async () => estado.todos,
      getTodoRaw: async () => estado.vivo,
    }),
  },
}));

import { importarBasecampCliente } from '../lib/basecamp/importar';
import { cambiosDeEnlazado, clasificarTodo, decidirMovido, fechasProyectoNuevo, filaDesdeTodo } from '../lib/basecamp/decisiones';
import { conCandado } from '../lib/candado';

const todo = (id: number, extra: Partial<TodoPlano> = {}): TodoPlano => ({
  id,
  titulo: `Tarea ${id}`,
  due_on: '2026-10-20',
  completed: false,
  completed_at: null,
  assignee_ids: [501],
  creator_id: null,
  creator_nombre: null,
  app_url: `https://bc/${id}`,
  created_at: '2026-10-10T01:00:00Z',
  bloque: null,
  grupoId: null,
  ...extra,
});
const ctx = { tenantId: 't', usuarioId: null, origen: 'cron' } as never;

beforeEach(() => {
  estado.insertados = [];
  estado.duplicados = new Set();
  estado.enlazados = [];
  estado.ignorados = new Set();
  estado.todos = [];
  estado.vivo = { status: 'active' };
  estado.conElNuevo = null;
  estado.actualizar.mockReset();
});

describe('decisiones de la importación', () => {
  it('clasifica enlazados, ignorados a mano, completados viejos y nuevos', () => {
    const o = { enlazados: new Set([1]), ignorados: new Set([2]), limiteCompletadosMs: Date.parse('2026-09-01') };
    expect(clasificarTodo(todo(1), o)).toBe('enlazado');
    expect(clasificarTodo(todo(2), o)).toBe('ignorado');
    expect(clasificarTodo(todo(3, { completed: true, completed_at: '2026-08-01T00:00:00Z' }), o)).toBe('completado_viejo');
    expect(clasificarTodo(todo(4), o)).toBe('nuevo');
  });
  it('la fila nueva trae su enlace a Basecamp, marcas del título y nunca es visible al cliente', () => {
    const f = filaDesdeTodo(todo(7, { titulo: '[PROPUESTA] Idea' }), {
      clienteId: 'c1',
      proyectoId: 'p1',
      listaId: 100,
      porBcUser: new Map([[501, 'u1']]),
    });
    expect(f).toMatchObject({
      basecamp_todo_id: 7,
      basecamp_todolist_id: 100,
      visible_cliente: false,
      clase: 'propuesta',
      owner_agencia: ['u1'],
    });
    // Pedido a las 20:00 de Guayaquil del 9: es del 9, no del 10 (día UTC).
    expect(f.fecha_pedido).toBe('2026-10-09');
  });
  it('un to-do sin asignar no borra los responsables de BackIO', () => {
    const ex = {
      id: 'r1',
      basecamp_todo_id: 1,
      owner_agencia: ['u9'],
      titulo_interno: 'Tarea 1',
      bloque_nombre: null,
      proyecto_id: 'p1',
      estado_operativo: 'priorizado',
    };
    expect(cambiosDeEnlazado(ex, todo(1, { assignee_ids: [] }), { proyectoId: 'p1', listaId: 100 }, new Map()).patch).toEqual({});
    expect(cambiosDeEnlazado(ex, todo(1), { proyectoId: 'p2', listaId: 100 }, new Map([[501, 'u1']])).patch).toEqual({
      proyecto_id: 'p2',
      basecamp_todolist_id: 100,
      owner_agencia: ['u1'],
    });
  });
  it('una tarea cerrada no cambia de responsables: es la historia de quién la hizo', () => {
    const ex = {
      id: 'r1',
      basecamp_todo_id: 1,
      owner_agencia: ['ex', 'u2'],
      titulo_interno: 'Tarea 1',
      bloque_nombre: null,
      proyecto_id: 'p1',
      estado_operativo: 'completado',
    };
    const mapa = new Map([[502, 'u2']]);
    const c = cambiosDeEnlazado(ex, todo(1, { assignee_ids: [501, 502] }), { proyectoId: 'p1', listaId: 100 }, mapa);
    expect(c.responsables).toBe(false);
    expect(c.patch.owner_agencia).toBeUndefined();
  });
  it('si Basecamp todavía asigna a alguien que se fue, BackIO conserva su reparto', () => {
    const ex = {
      id: 'r1',
      basecamp_todo_id: 1,
      owner_agencia: ['nuevo'],
      titulo_interno: 'Tarea 1',
      bloque_nombre: null,
      proyecto_id: 'p1',
      estado_operativo: 'en_ejecucion',
    };
    const mapa = new Map([
      [501, 'ex'],
      [502, 'u2'],
    ]);
    const c = cambiosDeEnlazado(ex, todo(1, { assignee_ids: [501, 502] }), { proyectoId: 'p1', listaId: 100 }, mapa, new Set(['ex']));
    expect(c.responsables).toBe(false);
    // Cuando Basecamp ya está al día (sin el inactivo), manda otra vez.
    expect(
      cambiosDeEnlazado(ex, todo(1, { assignee_ids: [502] }), { proyectoId: 'p1', listaId: 100 }, mapa, new Set(['ex'])).patch,
    ).toEqual({
      owner_agencia: ['u2'],
    });
  });
  it('una tarea nueva nunca nace a nombre de alguien que se fue', () => {
    const f = filaDesdeTodo(todo(8, { assignee_ids: [501, 502] }), {
      clienteId: 'c1',
      proyectoId: 'p1',
      listaId: 100,
      porBcUser: new Map([
        [501, 'ex'],
        [502, 'u2'],
      ]),
      inactivos: new Set(['ex']),
    });
    expect(f.owner_agencia).toEqual(['u2']);
  });
  it('fechas de un proyecto nuevo', () => {
    expect(fechasProyectoNuevo([{ due_on: '2026-10-20' }, { due_on: '2026-10-05' }], '2026-10-10')).toEqual({
      inicio: '2026-10-05',
      entrega: '2026-10-20',
    });
    expect(fechasProyectoNuevo([], '2026-10-10')).toEqual({ inicio: '2026-10-10', entrega: '2026-11-09' });
  });
});

describe('importarBasecampCliente (B6)', () => {
  it('webhook y job a la vez no duplican: una sola tarea por to-do', async () => {
    estado.todos = [todo(1), todo(2)];
    const [a, b] = await Promise.all([importarBasecampCliente(ctx, 'c1'), importarBasecampCliente(ctx, 'c1')]);
    expect(estado.insertados.map((x) => x.basecamp_todo_id).sort()).toEqual([1, 2]);
    expect(a.requerimientos_creados + b.requerimientos_creados).toBe(2);
  });
  it('si otro proceso lo enlazó primero, cuenta como ya enlazado y no falla', async () => {
    estado.todos = [todo(1)];
    estado.duplicados = new Set([1]);
    const r = await importarBasecampCliente(ctx, 'c1');
    expect(r).toMatchObject({ requerimientos_creados: 0, ya_enlazados: 1 });
  });
  it('no vuelve a crear un to-do descartado como huérfano', async () => {
    estado.todos = [todo(1), todo(2)];
    estado.ignorados = new Set([2]);
    await importarBasecampCliente(ctx, 'c1');
    expect(estado.insertados.map((x) => x.basecamp_todo_id)).toEqual([1]);
  });
});

// 16/10/2026 (caso de Grace): mover un to-do a otro proyecto de Basecamp crea uno nuevo; el id viejo redirige a él.
describe('to-do movido a otro proyecto de Basecamp', () => {
  const ex = {
    id: 'r-viejo',
    basecamp_todo_id: 7,
    owner_agencia: [],
    titulo_interno: 'Tend card',
    bloque_nombre: null,
    proyecto_id: 'p1',
    estado_operativo: 'en_ejecucion',
  };
  it('decide: nada si sigue en su proyecto; baja si el nuevo ya está en BackIO; reenlace si no', () => {
    expect(decidirMovido(ex, { id: 7, bucketId: 10 }, 10, null)).toEqual({ tipo: 'ninguno' });
    expect(decidirMovido(ex, { id: 8, bucketId: 20 }, 10, { id: 'r-nuevo' })).toEqual({ tipo: 'baja', conservado: 'r-nuevo' });
    expect(decidirMovido(ex, { id: 8, bucketId: 20 }, 10, null)).toEqual({ tipo: 'reenlazar', todoId: 8, bucketId: 20 });
  });
  it('si el to-do nuevo ya entró como tarea, la vieja se da de baja (no queda duplicada en dos clientes)', async () => {
    estado.enlazados = [ex];
    estado.vivo = { id: 8, status: 'active', bucket: { id: 20 } };
    estado.conElNuevo = { id: 'r-nuevo', deleted_at: null };
    const r = await importarBasecampCliente(ctx, 'c1');
    expect(estado.actualizar).toHaveBeenCalledWith(ctx, 'r-viejo', expect.objectContaining({ deleted_at: expect.any(String) }));
    expect(r.movidos_a_otro_proyecto).toBe(1);
    expect(r.eliminados_en_basecamp).toBe(0);
  });
  it('si todavía no entró, la tarea vieja pasa al to-do nuevo y a su cliente, oculta en el portal', async () => {
    estado.enlazados = [ex];
    estado.vivo = { id: 8, status: 'active', bucket: { id: 20 } };
    await importarBasecampCliente(ctx, 'c1');
    expect(estado.actualizar).toHaveBeenCalledWith(ctx, 'r-viejo', {
      basecamp_todo_id: 8,
      cliente_id: 'c-de-20',
      proyecto_id: null,
      visible_cliente: false,
    });
  });
  it('un to-do que sigue en su proyecto no se toca', async () => {
    estado.enlazados = [ex];
    estado.vivo = { id: 7, status: 'active', bucket: { id: 10 } };
    await importarBasecampCliente(ctx, 'c1');
    expect(estado.actualizar).not.toHaveBeenCalled();
  });
});

describe('conCandado', () => {
  it('serializa por clave y sigue tras un error', async () => {
    const orden: string[] = [];
    const lento = (n: string, ms: number) => async () => {
      orden.push(`ini ${n}`);
      await new Promise((r) => setTimeout(r, ms));
      orden.push(`fin ${n}`);
      if (n === 'a') throw new Error('x');
      return n;
    };
    const r = await Promise.allSettled([conCandado('k', lento('a', 10)), conCandado('k', lento('b', 1))]);
    expect(orden).toEqual(['ini a', 'fin a', 'ini b', 'fin b']);
    expect(r[1]).toEqual({ status: 'fulfilled', value: 'b' });
  });
});
