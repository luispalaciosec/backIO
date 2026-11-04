/** Buscador de los rituales: sin importar mayúsculas, tildes ni el orden de las palabras. */
export const normalizarBusqueda = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** ¿El texto tiene todas las palabras de la búsqueda? «amazonas reel oscar» encuentra «Reel 9 · Banco Amazonas · Óscar». */
export function coincideBusqueda(busqueda: string, texto: string): boolean {
  const palabras = normalizarBusqueda(busqueda).split(/\s+/).filter(Boolean);
  if (!palabras.length) return true;
  const t = normalizarBusqueda(texto);
  return palabras.every((p) => t.includes(p));
}
