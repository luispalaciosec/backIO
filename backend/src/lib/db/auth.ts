/**
 * Consultas del middleware de autenticación (lib/auth/middleware). Reciben el cliente explícito porque cada vía usa
 * el suyo: service role para API keys y OAuth, cliente con el JWT del usuario (RLS) para la sesión de la UI.
 */
import type { Db } from './client';

export async function getApiKeyPorHash(db: Db, keyHash: string) {
  const { data } = await db
    .from('api_keys')
    .select('id, tenant_id, nombre, scopes, perfil, cliente_id, revocada_at')
    .eq('key_hash', keyHash)
    .maybeSingle();
  return data;
}

/** Registra el último uso de la API key en segundo plano, sin esperar ni fallar. */
export function registrarUsoApiKey(db: Db, apiKeyId: string): void {
  // El builder de PostgREST es perezoso: sin then/await la petición nunca salía y ultimo_uso_at quedaba muerto.
  void db
    .from('api_keys')
    .update({ ultimo_uso_at: new Date().toISOString() })
    .eq('id', apiKeyId)
    .then(
      () => undefined,
      () => undefined,
    );
}

/** Usuario de la sesión de la UI (con el cliente del JWT: RLS aplica). */
export async function getUsuarioSesion(db: Db, usuarioId: string) {
  const { data } = await db.from('usuarios').select('tenant_id, rol, nombre, activo').eq('id', usuarioId).maybeSingle();
  return data;
}

/** Usuario dueño de un token OAuth, dentro de su tenant. */
export async function getUsuarioOAuth(db: Db, usuarioId: string, tenantId: string) {
  const { data } = await db.from('usuarios').select('rol, nombre, activo').eq('id', usuarioId).eq('tenant_id', tenantId).maybeSingle();
  return data;
}
