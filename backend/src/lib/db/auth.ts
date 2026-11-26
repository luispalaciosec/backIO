/**
 * Consultas del middleware de autenticación (lib/auth/middleware). Reciben el cliente explícito porque cada vía usa
 * el suyo: service role para API keys y OAuth, cliente con el JWT del usuario (RLS) para la sesión de la UI.
 */
import { log } from '../logger';
import { lanzarSiBaseCaida, serviceClient, type Db } from './client';

export async function getApiKeyPorHash(db: Db, keyHash: string) {
  const { data, error, status } = await db
    .from('api_keys')
    .select('id, tenant_id, nombre, scopes, perfil, cliente_id, revocada_at')
    .eq('key_hash', keyHash)
    .maybeSingle();
  lanzarSiBaseCaida(error, status);
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
  const { data, error, status } = await db.from('usuarios').select('tenant_id, rol, nombre, activo').eq('id', usuarioId).maybeSingle();
  lanzarSiBaseCaida(error, status);
  // 26/11: Auth aceptaba la sesión y la API de datos devolvía 401 con el mismo token; sin esto no quedaba el motivo.
  if (error)
    log.warn('[auth] la API de datos rechazó la sesión', {
      status,
      codigo: error.code ?? null,
      mensaje: error.message,
      detalle: error.details ?? null,
      pista: error.hint ?? null,
    });
  return data;
}

/** Usuario dueño de un token OAuth, dentro de su tenant. */
export async function getUsuarioOAuth(db: Db, usuarioId: string, tenantId: string) {
  const { data, error, status } = await db
    .from('usuarios')
    .select('rol, nombre, activo')
    .eq('id', usuarioId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  lanzarSiBaseCaida(error, status);
  return data;
}

/** Quién creó una API key: lo que un agente o una integración escribe en Basecamp va a su nombre. */
export async function creadorDeApiKey(apiKeyId: string): Promise<string | null> {
  const { data } = await serviceClient().from('api_keys').select('creado_por').eq('id', apiKeyId).maybeSingle();
  return data?.creado_por ?? null;
}
