/**
 * Credenciales de Basecamp del tenant (access/refresh token, cuenta). Viven en `integracion_credenciales`,
 * tabla sin políticas para usuarios: solo el service role la lee. Antes estaban en `tenants.config.basecamp`,
 * legible por cualquier usuario autenticado del tenant (hallazgo crítico de la revisión del 23/09/2026).
 * Mientras la migración 21 no esté aplicada, se cae al esquema viejo para no romper producción.
 */
import { serviceClient, throwIf } from '../db/client';
import type { BasecampConfig } from './oauth';

const TABLA = 'integracion_credenciales';
let tablaDisponible: boolean | null = null;

async function existeTabla(): Promise<boolean> {
  if (tablaDisponible !== null) return tablaDisponible;
  const { error } = await serviceClient().from(TABLA).select('tenant_id').limit(1);
  tablaDisponible = !error;
  return tablaDisponible;
}

export async function leerCredencialesBasecamp(tenantId: string): Promise<Partial<BasecampConfig> | null> {
  const db = serviceClient();
  if (await existeTabla()) {
    const { data, error } = await db.from(TABLA).select('datos').eq('tenant_id', tenantId).eq('proveedor', 'basecamp').maybeSingle();
    throwIf(error);
    if (data) return (data as { datos: Partial<BasecampConfig> }).datos;
  }
  const { data, error } = await db.from('tenants').select('config').eq('id', tenantId).single();
  throwIf(error);
  return ((data as { config: { basecamp?: Partial<BasecampConfig> } }).config?.basecamp) ?? null;
}

export async function guardarCredencialesBasecamp(tenantId: string, datos: Partial<BasecampConfig>): Promise<void> {
  const db = serviceClient();
  if (await existeTabla()) {
    const { error } = await db.from(TABLA).upsert({ tenant_id: tenantId, proveedor: 'basecamp', datos, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id,proveedor' });
    throwIf(error);
    return;
  }
  const { data, error } = await db.from('tenants').select('config').eq('id', tenantId).single();
  throwIf(error);
  const cfg = (data as { config: Record<string, unknown> }).config ?? {};
  const { error: e2 } = await db.from('tenants').update({ config: { ...cfg, basecamp: datos } }).eq('id', tenantId);
  throwIf(e2);
}

export async function borrarCredencialesBasecamp(tenantId: string): Promise<void> {
  const db = serviceClient();
  if (await existeTabla()) await db.from(TABLA).delete().eq('tenant_id', tenantId).eq('proveedor', 'basecamp');
  const { data } = await db.from('tenants').select('config').eq('id', tenantId).single();
  const { basecamp: _b, ...rest } = ((data as { config: Record<string, unknown> } | null)?.config ?? {}) as Record<string, unknown>;
  await db.from('tenants').update({ config: rest }).eq('id', tenantId);
}
