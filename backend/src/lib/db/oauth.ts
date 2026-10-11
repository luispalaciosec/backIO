/**
 * Tablas del servidor OAuth (oauth_clients, oauth_codes, oauth_tokens). Solo service role. Códigos y tokens se
 * guardan y se buscan por su hash: estas funciones reciben siempre el hash, nunca el valor en claro (lib/oauth).
 */
import { serviceClient, throwIf, type FilaInsert } from './client';

export async function insertarClienteOAuth(fila: FilaInsert<'oauth_clients'>): Promise<void> {
  const { error } = await serviceClient().from('oauth_clients').insert(fila);
  throwIf(error);
}

export async function getClienteOAuth(clientId: string) {
  const { data, error } = await serviceClient()
    .from('oauth_clients')
    .select('id, secret_hash, nombre, redirect_uris')
    .eq('id', clientId)
    .maybeSingle();
  throwIf(error);
  return data;
}

export async function insertarCodigoOAuth(fila: FilaInsert<'oauth_codes'>): Promise<void> {
  const { error } = await serviceClient().from('oauth_codes').insert(fila);
  throwIf(error);
}

export async function getCodigoOAuth(codeHash: string, clientId: string) {
  const { data, error } = await serviceClient()
    .from('oauth_codes')
    .select('*')
    .eq('code', codeHash)
    .eq('client_id', clientId)
    .maybeSingle();
  throwIf(error);
  return data;
}

/** Marca el código como usado solo si nadie lo usó antes (update condicional). Devuelve las filas marcadas. */
export async function marcarCodigoUsado(codeHash: string): Promise<{ code: string }[] | null> {
  const { data } = await serviceClient()
    .from('oauth_codes')
    .update({ usado_at: new Date().toISOString() })
    .eq('code', codeHash)
    .is('usado_at', null)
    .select('code');
  return data;
}

export async function insertarTokensOAuth(filas: FilaInsert<'oauth_tokens'>[]): Promise<void> {
  const { error } = await serviceClient().from('oauth_tokens').insert(filas);
  throwIf(error);
}

export async function getRefreshToken(tokenHash: string, clientId: string) {
  const { data, error } = await serviceClient()
    .from('oauth_tokens')
    .select('*')
    .eq('token_hash', tokenHash)
    .eq('tipo', 'refresh')
    .eq('client_id', clientId)
    .maybeSingle();
  throwIf(error);
  return data;
}

/** Revoca el refresh solo si sigue vivo (update condicional): devuelve las filas revocadas, vacío si otro ganó. */
export async function rotarRefreshToken(tokenHash: string, ahora: string): Promise<{ token_hash: string }[] | null> {
  const { data, error } = await serviceClient()
    .from('oauth_tokens')
    .update({ revocado_at: ahora })
    .eq('token_hash', tokenHash)
    .is('revocado_at', null)
    .select('token_hash');
  throwIf(error);
  return data;
}

/** Revoca todos los tokens vivos de un cliente para un usuario. */
export async function revocarTokensDeUsuario(clientId: string, usuarioId: string, ahora: string): Promise<void> {
  await serviceClient()
    .from('oauth_tokens')
    .update({ revocado_at: ahora })
    .eq('client_id', clientId)
    .eq('usuario_id', usuarioId)
    .is('revocado_at', null);
}

export async function revocarTokenPorHash(tokenHash: string): Promise<void> {
  await serviceClient().from('oauth_tokens').update({ revocado_at: new Date().toISOString() }).eq('token_hash', tokenHash);
}

export async function getAccessToken(tokenHash: string) {
  const { data } = await serviceClient()
    .from('oauth_tokens')
    .select('tenant_id, usuario_id, scope, client_id, expira_at, revocado_at')
    .eq('token_hash', tokenHash)
    .eq('tipo', 'access')
    .maybeSingle();
  return data;
}
