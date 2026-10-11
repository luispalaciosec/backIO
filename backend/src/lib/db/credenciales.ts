/**
 * Credenciales de Basecamp del tenant (access/refresh token, cuenta). Viven SOLO en `integracion_credenciales`,
 * tabla sin políticas para usuarios: todo pasa por el service role, nunca por el cliente del usuario.
 * Ver lib/basecamp/credenciales.ts para la historia (revisión 23/09 y auditoría 10/10, S4): no hay fallback a `tenants`.
 */
import { serviceClient, throwIf } from './client';
import type { BasecampConfig } from '../basecamp/oauth';

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
