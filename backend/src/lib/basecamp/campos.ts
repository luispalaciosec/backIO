/** Campos que se leen de un to-do de Basecamp (solo datos, nunca texto: docs/02). */

/**
 * Fecha de cierre de un to-do. Basecamp 3 no tiene `completed_at`: viene en `completion.created_at`. Hasta el
 * 28/10/2026 se leía `completed_at` y siempre salía vacía: 1.453 completadas quedaron sin fecha de cierre y el filtro de
 * «completados viejos» de la importación nunca funcionó.
 */
export function fechaDeCierre(t: {
  completed?: boolean;
  completed_at?: string | null;
  completion?: { created_at?: string } | null;
}): string | null {
  if (t.completed !== true) return null;
  return t.completion?.created_at ?? t.completed_at ?? null;
}
