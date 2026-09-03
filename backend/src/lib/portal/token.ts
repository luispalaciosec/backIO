import { randomBytes } from 'node:crypto';

/** 32 bytes aleatorios, URL-safe. Único por proyecto, rotable. */
export function generarPortalToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Expira 60 días después de fecha_entrega. */
export function portalExpirado(fechaEntrega: string, ahora: Date = new Date()): boolean {
  const limite = new Date(`${fechaEntrega}T23:59:59Z`).getTime() + 60 * 86_400_000;
  return ahora.getTime() > limite;
}
