/**
 * Validación de URLs antes de usarlas en navegación o en un href (auditoría de seguridad run-1).
 * React no bloquea `javascript:` en href, así que cualquier URL guardada o recibida pasa por aquí.
 */

/** URL externa segura para un enlace: solo https. Devuelve undefined si no lo es (el enlace queda inerte). */
export function hrefExterno(u: string | null | undefined): string | undefined {
  if (!u) return undefined;
  try { return new URL(u).protocol === 'https:' ? u : undefined; } catch { return undefined; }
}

/**
 * Ruta interna segura para redirigir después del login. Se resuelve con el mismo parser del navegador
 * (tabuladores y saltos de línea se descartan: «/\t/evil.com» es «//evil.com») y se exige el mismo origen.
 */
export function rutaInterna(next: string | null | undefined, porDefecto = '/backlog'): string {
  if (!next || typeof window === 'undefined') return porDefecto;
  try {
    const u = new URL(next, window.location.origin);
    return u.origin === window.location.origin ? `${u.pathname}${u.search}${u.hash}` : porDefecto;
  } catch { return porDefecto; }
}
