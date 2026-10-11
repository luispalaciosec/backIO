import type { Context } from 'hono';

/**
 * IP del cliente: la ÚLTIMA entrada de X-Forwarded-For, la que agrega el proxy de Railway. La primera la puede
 * escribir el propio cliente (auditoría run-1 y 10/10).
 */
export function ipCliente(c: Context): string {
  const xff = c.req.header('x-forwarded-for')?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  return xff[xff.length - 1] ?? c.req.header('x-real-ip') ?? 'ip';
}
