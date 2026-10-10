/**
 * Preguntas de permiso en un solo lugar (auditoría 10/10, §3.6). Antes cada ruta escribía su propia variante de
 * `a.tipo === 'usuario' && a.rol === 'colaborador'`, unas contando los tokens OAuth y otras no.
 */
import { ROLES_INTERNOS_GESTION } from '@backio/shared';
import type { AuthInfo } from './middleware';

/** Persona con rol colaborador, por la UI o por un agente (token OAuth) que actúa en su nombre. */
export const esColaborador = (a: AuthInfo): boolean => a.tipo === 'usuario' && a.rol === 'colaborador';

/** Colaborador con sesión de la UI (no un agente OAuth): el backend le aplica las reglas de «solo lo suyo». */
export const esColaboradorHumano = (a: AuthInfo): boolean => esColaborador(a) && a.perfil !== 'oauth';

/** Persona de gestión (admin, gerencia, operaciones, ejecutiva, líder), por la UI o por OAuth. */
export const esGestion = (a: AuthInfo): boolean => a.tipo === 'usuario' && !!a.rol && ROLES_INTERNOS_GESTION.includes(a.rol);
