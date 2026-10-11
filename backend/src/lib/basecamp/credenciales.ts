/**
 * Credenciales de Basecamp del tenant (access/refresh token, cuenta). Viven SOLO en `integracion_credenciales`,
 * tabla sin políticas para usuarios: solo el service role la lee.
 * Antes estaban en `tenants.config.basecamp`, legible por cualquier usuario autenticado (revisión del 23/09) y,
 * hasta el 10/10, quedaba un fallback a ese esquema: un error transitorio al arrancar lo activaba de por vida y una
 * reconexión volvía a escribir los tokens en `tenants` (auditoría 10/10, S4). Ya no hay fallback.
 */
import { serviceClient, throwIf } from '../db/client';
import type { BasecampConfig } from './oauth';

const TABLA = 'integracion_credenciales';

export async function leerCredencialesBasecamp(tenantId: string): Promise<Partial<BasecampConfig> | null> {
  const { data, error } = await serviceClient()
    .from(TABLA)
    .select('datos')
    .eq('tenant_id', tenantId)
    .eq('proveedor', 'basecamp')
    .maybeSingle();
  throwIf(error);
  return data ? (data as { datos: Partial<BasecampConfig> }).datos : null;
}

export async function guardarCredencialesBasecamp(tenantId: string, datos: Partial<BasecampConfig>): Promise<void> {
  const { error } = await serviceClient()
    .from(TABLA)
    .upsert(
      { tenant_id: tenantId, proveedor: 'basecamp', datos, updated_at: new Date().toISOString() },
      { onConflict: 'tenant_id,proveedor' },
    );
  throwIf(error);
}

export async function borrarCredencialesBasecamp(tenantId: string): Promise<void> {
  const db = serviceClient();
  const { error } = await db.from(TABLA).delete().eq('tenant_id', tenantId).eq('proveedor', 'basecamp');
  throwIf(error);
  // Limpieza de restos del esquema viejo, por si algún entorno los conserva (nunca se vuelven a escribir).
  const { data } = await db.from('tenants').select('config').eq('id', tenantId).single();
  const cfg = ((data as { config: Record<string, unknown> } | null)?.config ?? {}) as Record<string, unknown>;
  if ('basecamp' in cfg) {
    const { basecamp: _b, ...rest } = cfg;
    await db.from('tenants').update({ config: rest }).eq('id', tenantId);
  }
}
