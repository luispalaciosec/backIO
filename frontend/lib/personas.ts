/**
 * Directorio de personas para pantallas que muestran historia: se pide con `?incluir=inactivos` para que el nombre
 * de quien ya no tiene acceso no desaparezca, y los selectores ofrecen solo activos.
 */
import { nombrePersona } from '@backio/shared';

/** Ruta del directorio completo (activos + inactivos, cada uno con `activo`). */
export const USUARIOS_CON_INACTIVOS = '/usuarios?incluir=inactivos';

/** Para mostrar: `nombre` pasa a `nombrePersona(u)` («Ana (ex)» si ya no tiene acceso). */
export function conNombrePersona<T extends { nombre: string; activo: boolean }>(items: T[]): T[] {
  return items.map((u) => ({ ...u, nombre: nombrePersona(u) }));
}

/**
 * Para elegir: solo activos, más los ya elegidos aunque sean inactivos (se ven con «(ex)» y se pueden quitar,
 * pero el formulario no los pierde en silencio).
 */
export function elegibles<T extends { id: string; activo?: boolean }>(items: T[], actuales: (string | null | undefined)[] = []): T[] {
  return items.filter((u) => u.activo !== false || actuales.includes(u.id));
}
