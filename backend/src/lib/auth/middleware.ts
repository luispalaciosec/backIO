/**
 * Autenticación del backend.
 *
 *  Authorization: Bearer <jwt supabase>  → usuario interno (UI). RLS aplica.
 *  Authorization: Bearer bk_<key>        → API key con scopes (agentes, PrometIO). Service role + filtro tenant.
 */
import { createHash } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import type { Rol } from '@backio/shared';
import { ROLES_INTERNOS_GESTION } from '@backio/shared';
import { serviceClient, userClient, type DbCtx } from '../db/client';

export type Scope =
  | 'read:backlog'
  | 'read:proyectos'
  | 'read:senales'
  | 'read:capacidad'
  | 'write:requerimientos'
  | 'write:proyectos'
  | 'write:actas'
  | 'admin';

export interface AuthInfo {
  tipo: 'usuario' | 'api_key';
  ctx: DbCtx;
  rol: Rol | null;
  scopes: Scope[];
  nombre: string;
}

declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthInfo;
  }
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

async function resolveApiKey(key: string): Promise<AuthInfo | null> {
  const db = serviceClient();
  const { data } = await db
    .from('api_keys')
    .select('id, tenant_id, nombre, scopes, revocada_at')
    .eq('key_hash', hashApiKey(key))
    .maybeSingle();
  if (!data || (data as { revocada_at: string | null }).revocada_at) return null;
  const row = data as { id: string; tenant_id: string; nombre: string; scopes: Scope[] };
  void db.from('api_keys').update({ ultimo_uso_at: new Date().toISOString() }).eq('id', row.id);
  return {
    tipo: 'api_key',
    ctx: { db, tenantId: row.tenant_id, usuarioId: null, origen: 'api', apiKeyId: row.id },
    rol: null,
    scopes: row.scopes,
    nombre: row.nombre,
  };
}

async function resolveJwt(jwt: string): Promise<AuthInfo | null> {
  const db = userClient(jwt);
  const { data: auth, error } = await db.auth.getUser(jwt);
  if (error || !auth.user) return null;
  const { data: u } = await db.from('usuarios').select('tenant_id, rol, nombre, activo').eq('id', auth.user.id).maybeSingle();
  if (!u) return null;
  const usuario = u as { tenant_id: string; rol: Rol; nombre: string; activo: boolean };
  if (!usuario.activo) return null;
  return {
    tipo: 'usuario',
    ctx: { db, tenantId: usuario.tenant_id, usuarioId: auth.user.id, origen: 'ui' },
    rol: usuario.rol,
    scopes: [],
    nombre: usuario.nombre,
  };
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return c.json({ error: 'No autenticado' }, 401);
  }
  const info = token.startsWith('bk_') ? await resolveApiKey(token) : await resolveJwt(token);
  if (!info) return c.json({ error: 'Credenciales inválidas' }, 401);
  c.set('auth', info);
  await next();
};

/** Requiere scope (API key) o rol de gestión (usuario). */
export function requireScope(...scopes: Scope[]): MiddlewareHandler {
  return async (c, next) => {
    const a = c.get('auth');
    if (a.tipo === 'usuario') {
      const esEscritura = scopes.some((s) => s.startsWith('write:') || s === 'admin');
      if (esEscritura && !(a.rol && ROLES_INTERNOS_GESTION.includes(a.rol))) {
        return c.json({ error: 'Rol sin permisos de escritura' }, 403);
      }
      if (scopes.includes('admin') && a.rol !== 'admin') return c.json({ error: 'Solo admin' }, 403);
      return next();
    }
    const ok = a.scopes.includes('admin') || scopes.every((s) => a.scopes.includes(s));
    if (!ok) return c.json({ error: `Scope requerido: ${scopes.join(', ')}` }, 403);
    await next();
  };
}

export function ctxOf(c: Context): DbCtx {
  return c.get('auth').ctx;
}
