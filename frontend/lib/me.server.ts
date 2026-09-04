import type { Rol } from '@backio/shared';
import { apiServer } from './api.server';

export interface Me { nombre: string; rol: Rol | null; usuario_id: string | null }

/** Quién soy (rol) desde el backend; si falla, rol null (se trata como solo lectura). */
export async function meServer(): Promise<Me> {
  try { const m = await apiServer<{ nombre: string; rol: Rol | null; usuario_id: string | null }>('/usuarios/me'); return { nombre: m.nombre, rol: m.rol, usuario_id: m.usuario_id }; }
  catch { return { nombre: '', rol: null, usuario_id: null }; }
}

/** Roles que pueden generar/publicar (weekly, daily, proyectos). Espejo de ROLES_INTERNOS_GESTION del backend. */
export function puedeEscribir(rol: Rol | null): boolean {
  return rol !== null && rol !== 'colaborador';
}
