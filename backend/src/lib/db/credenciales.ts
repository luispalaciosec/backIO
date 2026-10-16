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

// ---------------------------------------------------------------- credenciales de cada persona (migración 33)
// Mismo criterio que las del tenant: tabla con RLS y sin políticas, solo service role.

export interface CredencialesPersona {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  email: string | null;
}

export async function leerCredencialesPersona(usuarioId: string): Promise<CredencialesPersona | null> {
  const { data, error } = await serviceClient()
    .from('basecamp_credenciales_usuario')
    .select('datos')
    .eq('usuario_id', usuarioId)
    .maybeSingle();
  throwIf(error);
  return data ? (data.datos as unknown as CredencialesPersona) : null;
}

export async function guardarCredencialesPersona(
  tenantId: string,
  usuarioId: string,
  basecampPersonId: number,
  datos: CredencialesPersona,
): Promise<void> {
  const ahora = new Date().toISOString();
  const { error } = await serviceClient()
    .from('basecamp_credenciales_usuario')
    .upsert(
      {
        usuario_id: usuarioId,
        tenant_id: tenantId,
        basecamp_person_id: basecampPersonId,
        datos: datos as never,
        conectado_at: ahora,
        updated_at: ahora,
      },
      { onConflict: 'usuario_id' },
    );
  throwIf(error);
}

/** Solo renueva los tokens (refresh), sin tocar la fecha de conexión. */
export async function actualizarTokensPersona(usuarioId: string, datos: CredencialesPersona): Promise<void> {
  const { error } = await serviceClient()
    .from('basecamp_credenciales_usuario')
    .update({ datos: datos as never, updated_at: new Date().toISOString() })
    .eq('usuario_id', usuarioId);
  throwIf(error);
}

export async function borrarCredencialesPersona(usuarioId: string): Promise<void> {
  const { error } = await serviceClient().from('basecamp_credenciales_usuario').delete().eq('usuario_id', usuarioId);
  throwIf(error);
}

/** Si la persona conectó su Basecamp, desde cuándo y con qué correo (nunca los tokens). */
export async function conexionPersona(usuarioId: string): Promise<{ conectado_at: string; email: string | null } | null> {
  const { data, error } = await serviceClient()
    .from('basecamp_credenciales_usuario')
    .select('conectado_at, datos')
    .eq('usuario_id', usuarioId)
    .maybeSingle();
  throwIf(error);
  return data ? { conectado_at: data.conectado_at, email: (data.datos as { email?: string | null }).email ?? null } : null;
}

/** Quién del tenant conectó su Basecamp y desde cuándo (para Admin → Usuarios). Nunca devuelve tokens. */
export async function conexionesDelTenant(tenantId: string): Promise<Map<string, string>> {
  const { data, error } = await serviceClient()
    .from('basecamp_credenciales_usuario')
    .select('usuario_id, conectado_at')
    .eq('tenant_id', tenantId);
  throwIf(error);
  return new Map((data ?? []).map((c) => [c.usuario_id, c.conectado_at]));
}
