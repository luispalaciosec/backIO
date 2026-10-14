import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/db/clientes', () => ({ getCliente: async () => ({ id: 'c1', basecamp_project_id: 10 }) }));
vi.mock('../lib/db/usuarios', () => ({ listUsuarios: async () => [] }));
vi.mock('../lib/db/proyectos', () => ({ updateProyecto: vi.fn() }));
vi.mock('../lib/db/requerimientos', () => ({ updateRequerimiento: vi.fn() }));
vi.mock('../lib/db/audit', () => ({ audit: vi.fn() }));

const { createProjectStructure } = await import('../lib/basecamp/write');

const req = (id: string, estado_operativo: string) =>
  ({
    id,
    titulo_interno: `Tarea ${id}`,
    estado_operativo,
    fecha_entrega: '2026-11-01',
    basecamp_todo_id: null,
    bloque_nombre: null,
    owner_agencia: [],
  }) as never;

describe('crear la estructura en Basecamp (reintento)', () => {
  it('no crea to-dos de tareas completadas ni canceladas: se crearían abiertos y reabrirían la tarea', async () => {
    const bc = {
      getTodosetId: vi.fn(async () => 1),
      listTodolists: vi.fn(async () => []),
      createTodolist: vi.fn(async () => ({ id: 2, app_url: 'u' })),
      listGroups: vi.fn(async () => []),
      createTodo: vi.fn(async () => ({ id: 99, app_url: 'u' })),
    };
    const proyecto = { id: 'p1', cliente_id: 'c1', nombre: 'P', basecamp_todolist_id: 2, basecamp_todoset_id: 1, basecamp_grupos: {} };
    const r = await createProjectStructure(
      { tenantId: 't' } as never,
      proyecto as never,
      [req('a', 'completado'), req('b', 'cancelado'), req('c', 'priorizado')],
      {
        bc: bc as never,
      },
    );
    expect(bc.createTodo).toHaveBeenCalledTimes(1);
    expect(r.creados).toBe(1);
  });
});
