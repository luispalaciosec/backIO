/**
 * Credenciales de Basecamp del tenant (access/refresh token, cuenta). Viven SOLO en `integracion_credenciales`,
 * tabla sin políticas para usuarios: solo el service role la lee (las consultas están en lib/db/credenciales.ts).
 * Antes estaban en `tenants.config.basecamp`, legible por cualquier usuario autenticado (revisión del 23/09) y,
 * hasta el 10/10, quedaba un fallback a ese esquema: un error transitorio al arrancar lo activaba de por vida y una
 * reconexión volvía a escribir los tokens en `tenants` (auditoría 10/10, S4). Ya no hay fallback.
 */
export { leerCredencialesBasecamp, guardarCredencialesBasecamp, borrarCredencialesBasecamp } from '../db/credenciales';
