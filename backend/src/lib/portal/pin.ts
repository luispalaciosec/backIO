/**
 * PIN del portal del cliente (auditoría 10/10, M3). Se guarda con scrypt + sal en `portal_pines`, tabla sin
 * políticas: solo el service role la lee. Antes estaba en claro dentro de `clientes.config`, legible por todo el tenant.
 * Formato: scrypt$N$r$p$sal$derivado (base64url).
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { actualizarConfigCliente, borrarPin, configsClientes, getHashPin, idsClientesConPin, upsertPin } from '../db/portal';

const N = 16384,
  R = 8,
  P = 1,
  LARGO = 32;

export function hashPin(pin: string): string {
  const sal = randomBytes(16);
  const derivado = scryptSync(pin, sal, LARGO, { N, r: R, p: P });
  return ['scrypt', N, R, P, sal.toString('base64url'), derivado.toString('base64url')].join('$');
}

export function pinCoincide(pin: string, guardado: string): boolean {
  const [alg, n, r, p, sal, derivado] = guardado.split('$');
  if (alg !== 'scrypt' || !sal || !derivado) return false;
  const esperado = Buffer.from(derivado, 'base64url');
  const calculado = scryptSync(pin, Buffer.from(sal, 'base64url'), esperado.length, { N: Number(n), r: Number(r), p: Number(p) });
  return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
}

export async function leerHashPin(clienteId: string): Promise<string | null> {
  return getHashPin(clienteId);
}

/** pin null = quitar el PIN del portal. */
export async function guardarPin(tenantId: string, clienteId: string, pin: string | null): Promise<void> {
  if (pin) await upsertPin({ cliente_id: clienteId, tenant_id: tenantId, hash: hashPin(pin), updated_at: new Date().toISOString() });
  else await borrarPin(tenantId, clienteId);
}

export async function clientesConPin(tenantId: string): Promise<Set<string>> {
  return new Set(await idsClientesConPin(tenantId));
}

/**
 * Pasa los PIN que todavía estén en claro en clientes.config a portal_pines y los borra de config. Idempotente.
 */
export async function migrarPinesEnClaro(tenantId: string): Promise<number> {
  let migrados = 0;
  for (const c of await configsClientes(tenantId)) {
    if (!c.config || !('portal_pin' in c.config)) continue;
    const { portal_pin: pin, ...resto } = c.config;
    if (typeof pin === 'string' && pin.trim()) {
      await guardarPin(tenantId, c.id, pin.trim());
      // Se comprueba el hash guardado antes de borrar el PIN en claro: si algo falla, el cliente conserva su PIN.
      const guardado = await leerHashPin(c.id);
      if (!guardado || !pinCoincide(pin.trim(), guardado))
        throw new Error(`El PIN del cliente ${c.id} no se pudo verificar; no se borró de config`);
      migrados += 1;
    }
    await actualizarConfigCliente(tenantId, c.id, resto);
  }
  return migrados;
}
