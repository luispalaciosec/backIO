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
import { lanzarSiBaseCaida, serviceClient, userClient, type DbCtx } from '../db/client';
import { getApiKeyPorHash, getUsuarioOAuth, getUsuarioSesion, registrarUsoApiKey } from '../db/auth';
import { resolverAccessToken } from '../oauth';

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
  perfil?: string | null;
  /** API key de perfil «cliente»: el único cliente cuyos datos puede leer (auditoría 10/10, S11). */
  clienteId?: string | null;
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
  const data = await getApiKeyPorHash(db, hashApiKey(key));
  if (!data || (data as { revocada_at: string | null }).revocada_at) return null;
  const row = data as { id: string; tenant_id: string; nombre: string; scopes: Scope[]; perfil: string | null; cliente_id: string | null };
  registrarUsoApiKey(db, row.id);
  return {
    tipo: 'api_key',
    ctx: { db, tenantId: row.tenant_id, usuarioId: null, origen: 'api', apiKeyId: row.id },
    rol: null,
    scopes: row.scopes,
    nombre: row.nombre,
    perfil: row.perfil,
    clienteId: row.cliente_id,
  };
}

/**
 * Sesiones ya validadas, por 60 s. Antes cada petición del navegador hacía dos consultas a la base solo para saber
 * quién la hacía (Auth y `usuarios`): era la mitad de la carga de una pantalla con varias llamadas. Un usuario dado de
 * baja o con otro rol lo nota en menos de un minuto; un token vencido nunca se acepta (se respeta su `exp`).
 */
const SESION_TTL_MS = 60_000;
const SESION_MAX = 500;
interface SesionValidada {
  hasta: number;
  usuarioId: string;
  tenantId: string;
  rol: Rol;
  nombre: string;
}
const sesiones = new Map<string, SesionValidada>();

/** Solo para tests. */
export function olvidarSesiones(): void {
  sesiones.clear();
}

function vencimientoDelToken(jwt: string): number {
  try {
    const exp = (JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString()) as { exp?: number }).exp;
    return typeof exp === 'number' ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

async function resolveJwt(jwt: string): Promise<AuthInfo | null> {
  const clave = createHash('sha256').update(jwt).digest('hex');
  const ahora = Date.now();
  const recordada = sesiones.get(clave);
  if (recordada && recordada.hasta > ahora) {
    return {
      tipo: 'usuario',
      ctx: { db: userClient(jwt), tenantId: recordada.tenantId, usuarioId: recordada.usuarioId, origen: 'ui' },
      rol: recordada.rol,
      scopes: [],
      nombre: recordada.nombre,
    };
  }
  sesiones.delete(clave);
  const db = userClient(jwt);
  const { data: auth, error } = await db.auth.getUser(jwt);
  // Si Auth no llega a la base, la sesión puede estar bien: decir «credenciales inválidas» confundió el 9/11/2026.
  lanzarSiBaseCaida(error);
  if (error || !auth.user) return null;
  const u = await getUsuarioSesion(db, auth.user.id);
  if (!u) return null;
  const usuario = u as { tenant_id: string; rol: Rol; nombre: string; activo: boolean };
  if (!usuario.activo) return null;
  const hasta = Math.min(ahora + SESION_TTL_MS, vencimientoDelToken(jwt));
  if (hasta > ahora) {
    if (sesiones.size >= SESION_MAX) sesiones.delete(sesiones.keys().next().value as string);
    sesiones.set(clave, { hasta, usuarioId: auth.user.id, tenantId: usuario.tenant_id, rol: usuario.rol, nombre: usuario.nombre });
  }
  return {
    tipo: 'usuario',
    ctx: { db, tenantId: usuario.tenant_id, usuarioId: auth.user.id, origen: 'ui' },
    rol: usuario.rol,
    scopes: [],
    nombre: usuario.nombre,
  };
}

async function resolveOAuth(token: string): Promise<AuthInfo | null> {
  const t = await resolverAccessToken(token);
  if (!t) return null;
  const db = serviceClient();
  const u = await getUsuarioOAuth(db, t.usuario_id, t.tenant_id);
  const usuario = u as { rol: Rol; nombre: string; activo: boolean } | null;
  if (!usuario?.activo) return null;
  return {
    tipo: 'usuario',
    ctx: { db, tenantId: t.tenant_id, usuarioId: t.usuario_id, origen: 'mcp' },
    rol: usuario.rol,
    scopes: t.scopes as Scope[],
    nombre: usuario.nombre,
    perfil: 'oauth',
  };
}

function wwwAuthenticate(): Record<string, string> {
  const base = (process.env.BACKEND_PUBLIC_URL ?? '').replace(/\/$/, '');
  return base ? { 'WWW-Authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"` } : {};
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return c.json({ error: 'No autenticado' }, 401, wwwAuthenticate());
  }
  const info = token.startsWith('bk_')
    ? await resolveApiKey(token)
    : token.startsWith('bko_')
      ? await resolveOAuth(token)
      : await resolveJwt(token);
  if (!info) return c.json({ error: 'Credenciales inválidas' }, 401, wwwAuthenticate());
  c.set('auth', info);
  await next();
};

/** Requiere scope (API key) o rol de gestión (usuario). */
export function requireScope(...scopes: Scope[]): MiddlewareHandler {
  return async (c, next) => {
    const a = c.get('auth');
    if (a.tipo === 'usuario') {
      // Token OAuth (agente en nombre de un usuario): solo los scopes concedidos y nunca admin, aunque el dueño lo sea.
      if (a.perfil === 'oauth' && (scopes.includes('admin') || !scopes.every((s) => a.scopes.includes(s)))) {
        return c.json({ error: `Scope OAuth requerido: ${scopes.join(', ')}` }, 403);
      }
      const esEscritura = scopes.some((s) => s.startsWith('write:') || s === 'admin');
      if (esEscritura && !(a.rol && ROLES_INTERNOS_GESTION.includes(a.rol))) {
        return c.json({ error: 'Rol sin permisos de escritura' }, 403);
      }
      if (scopes.includes('admin') && a.rol !== 'admin') return c.json({ error: 'Solo admin' }, 403);
      return next();
    }
    // Las API keys de perfil cliente solo operan por el MCP, que sanitiza la salida. En la REST verían datos internos.
    if (a.perfil === 'cliente') return c.json({ error: 'Esta credencial solo puede usarse a través del MCP' }, 403);
    const ok = a.scopes.includes('admin') || scopes.every((s) => a.scopes.includes(s));
    if (!ok) return c.json({ error: `Scope requerido: ${scopes.join(', ')}` }, 403);
    await next();
  };
}

export function ctxOf(c: Context): DbCtx {
  return c.get('auth').ctx;
}
