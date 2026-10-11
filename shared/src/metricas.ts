/** Porcentaje entero de a sobre b; null si no hay base. */
export function porcentaje(a: number, b: number): number | null {
  return b ? Math.round((a / b) * 100) : null;
}

/** Fracción (0–1) como porcentaje con un decimal: 0.875 → «87.5%». «—» si no hay dato. */
export function formatoFraccion(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${Math.round(v * 1000) / 10}%`;
}
