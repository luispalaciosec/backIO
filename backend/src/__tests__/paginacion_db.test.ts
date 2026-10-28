import { describe, expect, it } from 'vitest';
import { listBacklog } from '../lib/db/requerimientos';
import { enLotes } from '../lib/db/paginar';

/** Base falsa que, como PostgREST, devuelve como mucho 1000 filas por consulta según `.range()`. */
function baseFalsa(total: number) {
  const consultas: [number, number][] = [];
  const filas = Array.from({ length: total }, (_, i) => ({ id: `r${i}`, peso: '1' }));
  const q: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'eq', 'in', 'not', 'gte', 'lte', 'ilike', 'or', 'contains', 'order']) q[m] = () => q;
  q.range = (a: number, b: number) => {
    consultas.push([a, b]);
    return Promise.resolve({ data: filas.slice(a, Math.min(b + 1, a + 1000)), error: null });
  };
  return { db: q, consultas };
}

// Revisión del 28/10/2026: con 2.586 requerimientos, listBacklog devolvía solo 1000 sin aviso.
describe('consultas grandes sin cortes', () => {
  it('listBacklog trae todas las páginas', async () => {
    const { db, consultas } = baseFalsa(2586);
    const r = await listBacklog({ db, tenantId: 't' } as never);
    expect(r).toHaveLength(2586);
    expect(consultas).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    expect(r[0]!.peso).toBe(1);
  });
  it('una mesa sin clientes ni proyectos no consulta', async () => {
    const { db, consultas } = baseFalsa(10);
    expect(await listBacklog({ db, tenantId: 't' } as never, { mesa: { clienteIds: [], proyectoIds: [] } })).toEqual([]);
    expect(consultas).toEqual([]);
  });
  it('enLotes parte la lista de ids y junta los resultados', async () => {
    const lotes: number[] = [];
    const ids = Array.from({ length: 450 }, (_, i) => `id${i}`);
    const r = await enLotes(ids, async (l) => {
      lotes.push(l.length);
      return l;
    });
    expect(lotes).toEqual([200, 200, 50]);
    expect(r).toHaveLength(450);
  });
});
