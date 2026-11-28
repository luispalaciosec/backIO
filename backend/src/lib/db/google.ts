/**
 * Google Calendar de cada persona (migración 55, docs/23). Como `basecamp_credenciales_usuario`: tabla con RLS y sin
 * políticas, solo service role. Nunca devuelve tokens fuera del backend.
 */
import { serviceClient, throwIf } from './client';

export interface TokensGoogle {
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

export async function leerTokensGoogle(usuarioId: string): Promise<TokensGoogle | null> {
  const { data, error } = await serviceClient()
    .from('google_credenciales_usuario')
    .select('datos')
    .eq('usuario_id', usuarioId)
    .maybeSingle();
  throwIf(error);
  return data ? (data.datos as TokensGoogle) : null;
}

export async function guardarGoogle(tenantId: string, usuarioId: string, email: string, datos: TokensGoogle): Promise<void> {
  const ahora = new Date().toISOString();
  const { error } = await serviceClient()
    .from('google_credenciales_usuario')
    .upsert(
      { usuario_id: usuarioId, tenant_id: tenantId, email, datos: datos as never, conectado_at: ahora, updated_at: ahora },
      { onConflict: 'usuario_id' },
    );
  throwIf(error);
}

export async function actualizarTokensGoogle(usuarioId: string, datos: TokensGoogle): Promise<void> {
  const { error } = await serviceClient()
    .from('google_credenciales_usuario')
    .update({ datos: datos as never, updated_at: new Date().toISOString() })
    .eq('usuario_id', usuarioId);
  throwIf(error);
}

export async function borrarGoogle(usuarioId: string): Promise<void> {
  const { error } = await serviceClient().from('google_credenciales_usuario').delete().eq('usuario_id', usuarioId);
  throwIf(error);
}

/** Si la persona conectó su Google Calendar, desde cuándo y con qué correo. */
export async function conexionGoogle(usuarioId: string): Promise<{ conectado_at: string; email: string } | null> {
  const { data, error } = await serviceClient()
    .from('google_credenciales_usuario')
    .select('conectado_at, email')
    .eq('usuario_id', usuarioId)
    .maybeSingle();
  throwIf(error);
  return data ?? null;
}

/** Quiénes del tenant conectaron su calendario (para sincronizar). */
export async function conectadosGoogle(tenantId: string): Promise<{ usuario_id: string; email: string }[]> {
  const { data, error } = await serviceClient().from('google_credenciales_usuario').select('usuario_id, email').eq('tenant_id', tenantId);
  throwIf(error);
  return data ?? [];
}
