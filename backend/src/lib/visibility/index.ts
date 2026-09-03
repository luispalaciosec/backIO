/**
 * ZONA DE REVISIÓN HUMANA OBLIGATORIA (CLAUDE.md · lib/visibility/)
 * La implementación canónica vive en @backio/shared/visibility para que el
 * preview del Builder (frontend) y el portal (backend) usen LA MISMA función.
 * Este módulo solo la re-exporta y añade el guard del endpoint público.
 */
export { sanitizeForClient, assertClientSafe, mapEstadoCliente, CAMPOS_PROHIBIDOS_CLIENTE } from '@backio/shared';
export type { ClientSafeProject, ClientSafeRequirement } from '@backio/shared';
