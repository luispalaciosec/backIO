import { describe, expect, it, vi } from 'vitest';

const e = vi.hoisted(() => ({ upsert: vi.fn(async (_ctx: unknown, filas: unknown[]) => filas.length), opts: [] as unknown[] }));

vi.mock('../lib/db/horas', () => ({
  listRequerimientosConTodo: async () => [{ basecamp_todo_id: 70, id: 'r1' }],
  upsertHoras: e.upsert,
  listHorasDesde: async () => [],
}));
vi.mock('../lib/db/clientes', () => ({ listClientes: async () => [{ id: 'c1', basecamp_project_id: 10 }] }));
vi.mock('../lib/db/usuarios', () => ({
  listUsuarios: async (_ctx: unknown, opts: { incluirInactivos?: boolean } = {}) => {
    e.opts.push(opts);
    const todos = [
      { id: 'activa', basecamp_user_id: 1, activo: true },
      { id: 'se_fue', basecamp_user_id: 2, activo: false },
    ];
    return opts.incluirInactivos ? todos : todos.filter((u) => u.activo);
  },
}));
vi.mock('../lib/db/audit', () => ({ audit: vi.fn() }));
vi.mock('../lib/basecamp/client', () => ({
  BasecampClient: {
    forTenant: async () => ({
      timesheetSafe: async () => [
        { id: 900, bucket_id: 10, parent_id: 70, person_id: 1, fecha: '2026-10-01', horas: 2 },
        { id: 901, bucket_id: 10, parent_id: 70, person_id: 2, fecha: '2026-10-02', horas: 3 },
      ],
    }),
  },
}));

const { sincronizarHoras } = await import('../lib/horas');

describe('horas de quien se fue', () => {
  it('la resincronización conserva la persona aunque ya no esté activa', async () => {
    await sincronizarHoras({ tenantId: 't', usuarioId: null, origen: 'cron' } as never);
    const filas = e.upsert.mock.calls.flatMap((c) => c[1] as { basecamp_entry_id: number; usuario_id: string | null }[]);
    expect(filas.find((f) => f.basecamp_entry_id === 901)?.usuario_id).toBe('se_fue');
    expect(filas.find((f) => f.basecamp_entry_id === 900)?.usuario_id).toBe('activa');
  });
});
