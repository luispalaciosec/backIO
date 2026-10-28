import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
process.env.BASECAMP_ACCOUNT_ID = '1';

vi.mock('../lib/db/credenciales', () => ({
  leerCredencialesBasecamp: async () => ({ access_token: 'a', refresh_token: 'r', expires_at: '2099-01-01T00:00:00Z' }),
}));

import { BasecampClient } from '../lib/basecamp/client';
import { recorrerTodos } from '../lib/basecamp/recorrer';

const pagina = (items: unknown[], next?: string) =>
  new Response(JSON.stringify(items), { status: 200, headers: next ? { Link: `<${next}>; rel="next"` } : {} });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

// 28/10/2026 (Carolina): Banco Amazonas tiene 49 listas y BackIO leía solo la primera página (15). «Campaña Factoring» y
// «Neo cuenta» nunca entraron.
describe('listas de Basecamp con varias páginas', () => {
  it('lee todas las páginas de listas, no solo la primera', async () => {
    const p1 = Array.from({ length: 15 }, (_, i) => ({ id: i + 1, name: `Lista ${i + 1}` }));
    fetchMock
      .mockResolvedValueOnce(pagina(p1, 'https://3.basecampapi.com/1/buckets/9/todosets/5/todolists.json?status=active&page=2'))
      .mockResolvedValueOnce(pagina([{ id: 99, name: 'Campaña Factoring', completed: false }]));
    const bc = await BasecampClient.forTenant('t');
    const listas = await bc.listTodolists(9, 5);
    expect(listas).toHaveLength(16);
    expect(listas.at(-1)).toEqual({ id: 99, name: 'Campaña Factoring', completed: false });
  });

  it('el recorrido salta las listas completadas (sin trabajo abierto) y recorre las demás', async () => {
    const bc = {
      getTodosetId: async () => 5,
      listTodolists: async () => [
        { id: 1, name: 'Vieja', completed: true },
        { id: 2, name: 'Campaña Factoring', completed: false },
      ],
      listGroups: vi.fn(async () => []),
      listTodosSafe: vi.fn(async (_p: number, lista: number) => (lista === 2 ? [{ id: 7, titulo: 'Cuña Radio Factoring' }] : [])),
    };
    const { listas } = await recorrerTodos(bc as never, 9);
    expect(listas.map((l) => l.lista.name)).toEqual(['Campaña Factoring']);
    expect(bc.listGroups).not.toHaveBeenCalledWith(9, 1);
    expect(listas[0]!.todos[0]).toMatchObject({ id: 7, bloque: null });
  });
});
