/**
 * PIN del portal del cliente (auditoría 10/10, M3). Se guarda con scrypt + sal en `portal_pines`, tabla sin
 * políticas: solo el service role la lee. Antes estaba en claro dentro de `clientes.config`, legible por todo el tenant.
 * Formato: scrypt$N$r$p$sal$derivado (base64url).
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { serviceClient, throwIf } from '../db/client';

const N = 16384, R = 8, P = 1, LARGO = 32;

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
  const { data, error } = await serviceClient().from('portal_pines').select('hash').eq('cliente_id', clienteId).maybeSingle();
  throwIf(error);
  return (data as { hash: string } | null)?.hash ?? null;
}

/** pin null = quitar el PIN del portal. */
export async function guardarPin(tenantId: string, clienteId: string, pin: string | null): Promise<void> {
  const db = serviceClient();
  const { error } = pin
    ? await db.from('portal_pines').upsert({ cliente_id: clienteId, tenant_id: tenantId, hash: hashPin(pin), updated_at: new Date().toISOString() }, { onConflict: 'cliente_id' })
    : await db.from('portal_pines').delete().eq('cliente_id', clienteId).eq('tenant_id', tenantId);
  throwIf(error);
}

export async function clientesConPin(tenantId: string): Promise<Set<string>> {
  const { data, error } = await serviceClient().from('portal_pines').select('cliente_id').eq('tenant_id', tenantId);
  throwIf(error);
  return new Set(((data ?? []) as { cliente_id: string }[]).map((x) => x.cliente_id));
}

/**
 * Pasa los PIN que todavía estén en claro en clientes.config a portal_pines y los borra de config. Idempotente.
 */
export async function migrarPinesEnClaro(tenantId: string): Promise<number> {
  const db = serviceClient();
  const { data, error } = await db.from('clientes').select('id, config').eq('tenant_id', tenantId);
  throwIf(error);
  let migrados = 0;
  for (const c of (data ?? []) as { id: string; config: Record<string, unknown> | null }[]) {
    if (!c.config || !('portal_pin' in c.config)) continue;
    const { portal_pin: pin, ...resto } = c.config;
    if (typeof pin === 'string' && pin.trim()) {
      await guardarPin(tenantId, c.id, pin.trim());
      // Se comprueba el hash guardado antes de borrar el PIN en claro: si algo falla, el cliente conserva su PIN.
      const guardado = await leerHashPin(c.id);
      if (!guardado || !pinCoincide(pin.trim(), guardado)) throw new Error(`El PIN del cliente ${c.id} no se pudo verificar; no se borró de config`);
      migrados += 1;
    }
    const { error: e2 } = await db.from('clientes').update({ config: resto }).eq('id', c.id).eq('tenant_id', tenantId);
    throwIf(e2);
  }
  return migrados;
}
