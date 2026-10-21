import { beforeEach, describe, expect, it, vi } from 'vitest';

const e = vi.hoisted(() => ({
  activos: [] as Record<string, unknown>[],
  todos: new Map<number, unknown>(),
  proyectoDe: new Map<string, number | null>(),
  aplicar: vi.fn(),
  push: vi.fn(),
  audit: vi.fn(),
  getCliente: vi.fn(),
  quien: null as string | null,
  responsable: vi.fn(),
}));

vi.mock('../lib/db/requerimientos', () => ({ listBacklog: async () => e.activos, marcarDueOnVisto: async () => undefined }));
vi.mock('../lib/db/clientes', () => ({ getCliente: e.getCliente }));
vi.mock('../lib/db/audit', () => ({ audit: e.audit }));
vi.mock('../lib/basecamp/write', () => ({ pushDueDate: e.push }));
vi.mock('../lib/basecamp/sync', async (orig) => ({ ...(await orig<object>()), applyBasecampUpdate: e.aplicar }));
vi.mock('../lib/db/historial', () => ({ ultimoQueReprogramo: async () => e.quien }));
vi.mock('../lib/basecamp/client', () => ({
  BasecampClient: {
    forResponsable: e.responsable,
    forTenant: async () => ({
      cuenta: 'organizacion',
      getTodoRaw: async (_p: number, id: number) => {
        const t = e.todos.get(id);
        if (t instanceof Error) throw t;
        return t;
      },
    }),
  },
}));

import { reconcileTenant } from '../lib/basecamp/reconcile';

const ctx = { tenantId: 't', usuarioId: null, origen: 'cron' } as never;
const req = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `r${n}`,
  cliente_id: 'c1',
  basecamp_todo_id: n,
  fecha_entrega: '2026-10-20',
  ...extra,
});
const todo = (n: number, extra: Record<string, unknown> = {}) => ({ id: n, completed: false, due_on: '2026-10-20', ...extra });

beforeEach(() => {
  e.activos = [];
  e.todos = new Map();
  e.proyectoDe = new Map([['c1', 10]]);
  e.getCliente
    .mockReset()
    .mockImplementation(async (_c: unknown, id: string) => ({ id, basecamp_project_id: e.proyectoDe.get(id) ?? null }));
  e.aplicar.mockReset().mockResolvedValue({ aplicado: false });
  e.push.mockReset().mockResolvedValue(undefined);
  e.quien = 'ana';
  // Sin persona, o persona sin su Basecamp conectado: null (nunca la cuenta de otro).
  e.responsable.mockReset().mockImplementation(async (_t: string, u: string | null) => (u && u !== 'sin_conectar' ? { cuenta: u } : null));
  e.audit.mockReset();
});

// Ola 8: la reconciliación cada 30 min no tenía tests (Basecamp manda sobre completed; BackIO sobre la fecha).
describe('reconcileTenant', () => {
  it('aplica lo que Basecamp sabe (completed) y cuenta lo aplicado', async () => {
    e.activos = [req(1), req(2)];
    e.todos.set(1, todo(1, { completed: true }));
    e.todos.set(2, todo(2));
    e.aplicar.mockImplementation(async (_c: unknown, p: { completed: boolean }) => ({ aplicado: p.completed }));
    expect(await reconcileTenant(ctx)).toEqual({ revisados: 2, aplicados: 1 });
  });
  it('si la fecha de Basecamp quedó desfasada, reenvía la de BackIO y lo audita (regla 3)', async () => {
    e.activos = [req(1), req(2)];
    e.todos.set(1, todo(1, { due_on: '2026-10-25' }));
    e.todos.set(2, todo(2));
    await reconcileTenant(ctx);
    expect(e.push).toHaveBeenCalledTimes(1);
    expect(e.audit).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        accion: 'basecamp_fecha_reenviada',
        detalle: expect.objectContaining({ basecamp: '2026-10-25', backio: '2026-10-20' }),
      }),
    );
  });
  it('no reenvía más de 25 fechas por corrida (M14)', async () => {
    for (let n = 1; n <= 30; n++) {
      e.activos.push(req(n));
      e.todos.set(n, todo(n, { due_on: '2026-11-01' }));
    }
    await reconcileTenant(ctx);
    expect(e.push).toHaveBeenCalledTimes(25);
  });
  it('un to-do que falla no detiene al resto; clientes sin proyecto se saltan; el cliente se consulta una vez', async () => {
    e.activos = [req(1), req(2), req(3, { cliente_id: 'c2' }), req(4)];
    e.proyectoDe.set('c2', null);
    e.todos.set(1, new Error('Basecamp 500'));
    e.todos.set(2, todo(2, { completed: true }));
    e.todos.set(4, todo(4, { completed: true }));
    e.aplicar.mockResolvedValue({ aplicado: true });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await reconcileTenant(ctx)).toEqual({ revisados: 4, aplicados: 2 });
    expect(e.getCliente).toHaveBeenCalledTimes(2);
  });
  it('sin tareas enlazadas no llama a Basecamp', async () => {
    e.activos = [req(1, { basecamp_todo_id: null })];
    expect(await reconcileTenant(ctx)).toEqual({ revisados: 0, aplicados: 0 });
  });
  // 16/10/2026: la fecha reenviada sale a nombre de quien la cambió en BackIO, no de quien conectó la integración.
  // 19/10/2026: y si esa persona no conectó su Basecamp (o no se sabe quién fue), no se reenvía con la cuenta de nadie.
  it('reenvía la fecha con la cuenta de quien la cambió por última vez; si no hay quien, no se escribe', async () => {
    e.activos = [req(1)];
    e.todos.set(1, todo(1, { due_on: '2026-10-25' }));
    e.quien = 'johanna';
    await reconcileTenant(ctx);
    expect(e.responsable).toHaveBeenCalledWith('t', 'johanna');
    expect(e.push.mock.calls[0]![2]).toEqual({ cuenta: 'johanna' });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const quien of [null, 'sin_conectar']) {
      e.quien = quien;
      e.push.mockClear();
      e.audit.mockClear();
      await reconcileTenant(ctx);
      expect(e.push).not.toHaveBeenCalled();
      expect(e.audit).not.toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({ accion: 'basecamp_fecha_reenviada', detalle: expect.objectContaining({ basecamp: '2026-10-25' }) }),
      );
      e.audit.mockClear();
    }
  });
  // 19/10/2026 (Grace): si la fecha se cambió en Basecamp después que en BackIO, BackIO la acepta y no la pisa.
  it('si la fecha nueva de Basecamp se aceptó como reprogramación, no se reenvía la vieja', async () => {
    e.activos = [req(1)];
    e.todos.set(1, todo(1, { due_on: '2026-10-25' }));
    e.aplicar.mockResolvedValue({ aplicado: true, fecha_aceptada: true });
    await reconcileTenant(ctx);
    expect(e.push).not.toHaveBeenCalled();
  });
  it('un to-do movido a otro proyecto (Basecamp redirige a otro id) no se compara ni se escribe', async () => {
    e.activos = [req(1)];
    e.todos.set(1, todo(99, { due_on: '2026-10-25' }));
    await reconcileTenant(ctx);
    expect(e.aplicar).not.toHaveBeenCalled();
    expect(e.push).not.toHaveBeenCalled();
  });
});
