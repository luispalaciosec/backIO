import { throwIf } from './client';

/** Lee todas las filas de una consulta de Supabase en páginas de 1000 (el tope de PostgREST). */
export async function paginar<T>(consulta: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await consulta(from, from + 999);
    throwIf(error as never);
    const filas = (data ?? []) as T[];
    out.push(...filas);
    if (filas.length < 1000) break;
  }
  return out;
}
