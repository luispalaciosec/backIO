/**
 * Candado en memoria por clave: la segunda llamada con la misma clave espera a que termine la primera.
 * Basta con una réplica (Railway corre una); entre réplicas, la defensa es el índice único de la base.
 */
const enCurso = new Map<string, Promise<unknown>>();

export async function conCandado<T>(clave: string, fn: () => Promise<T>): Promise<T> {
  const previa = enCurso.get(clave) ?? Promise.resolve();
  const actual = previa.then(fn, fn);
  const cola = actual.catch(() => undefined);
  enCurso.set(clave, cola);
  try {
    return await actual;
  } finally {
    if (enCurso.get(clave) === cola) enCurso.delete(clave);
  }
}
