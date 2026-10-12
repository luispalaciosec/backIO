import { describe, expect, it, vi } from 'vitest';
import { reemplazarResponsableEnTodos, LIMITE_TODOS_POR_OPERACION } from '../lib/basecamp/write';

const ctx = { tenantId: 't', usuarioId: 'admin', origen: 'ui' } as never;
function cliente(vivos: Record<number, number[]>, fallan: number[] = []) {
  return {
    request: vi.fn(async (_m: string, path: string) => {
      const id = Number(/todos\/(\d+)/.exec(path)![1]);
      if (fallan.includes(id)) throw new Error('404');
      return { assignees: (vivos[id] ?? []).map((x) => ({ id: x })) };
    }),
    updateTodo: vi.fn(async () => undefined),
  };
}
const cambio = (todoId: number, entra: number | null) => ({ requerimientoId: `r${todoId}`, projectId: 10, todoId, sale: 501, entra });

describe('reemplazar responsable en Basecamp (salida)', () => {
  it('saca a quien se va, pone al reemplazo y conserva a los demás asignados', async () => {
    const bc = cliente({ 1: [501, 777], 2: [501] });
    const r = await reemplazarResponsableEnTodos(ctx, [cambio(1, 502), cambio(2, null)], bc as never);
    expect(bc.updateTodo).toHaveBeenNthCalledWith(1, 10, 1, { assignee_ids: [777, 502] });
    expect(bc.updateTodo).toHaveBeenNthCalledWith(2, 10, 2, { assignee_ids: [] });
    expect(r).toEqual({ actualizados: 2, sin_cambios: 0, errores: [] });
  });
  it('no escribe si Basecamp ya está al día', async () => {
    const bc = cliente({ 1: [502] });
    expect(await reemplazarResponsableEnTodos(ctx, [cambio(1, 502)], bc as never)).toMatchObject({ actualizados: 0, sin_cambios: 1 });
    expect(bc.updateTodo).not.toHaveBeenCalled();
  });
  it('un to-do que falla no detiene al resto', async () => {
    const bc = cliente({ 2: [501] }, [1]);
    const r = await reemplazarResponsableEnTodos(ctx, [cambio(1, 502), cambio(2, 502)], bc as never);
    expect(r.actualizados).toBe(1);
    expect(r.errores).toEqual([{ requerimientoId: 'r1', error: '404' }]);
  });
  it(`nunca más de ${LIMITE_TODOS_POR_OPERACION} to-dos por llamada`, async () => {
    const bc = cliente({});
    const muchos = Array.from({ length: LIMITE_TODOS_POR_OPERACION + 1 }, (_, i) => cambio(i, 502));
    await expect(reemplazarResponsableEnTodos(ctx, muchos, bc as never)).rejects.toThrow(/Como máximo/);
    expect(bc.request).not.toHaveBeenCalled();
  });
});
