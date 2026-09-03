/**
 * Toda query a Supabase pasa por lib/db. Sin llamadas directas desde rutas.
 *
 * Dos modos:
 *  - userClient(jwt): cliente con el JWT del usuario → RLS aplica.
 *  - serviceClient(): service role, bypass RLS. SOLO para webhooks, cron, portal
 *    público y API keys. Toda función de lib/db que lo use filtra por tenant_id.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../../config/env';

export type Db = SupabaseClient;

export interface DbCtx {
  db: Db;
  tenantId: string;
  usuarioId: string | null;
  origen: 'ui' | 'api' | 'mcp' | 'webhook:basecamp' | 'webhook:prometio' | 'cron' | 'portal';
  apiKeyId?: string | null;
}

let service: Db | null = null;

export function serviceClient(): Db {
  if (service) return service;
  const e = env();
  service = createClient(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return service;
}

export function userClient(jwt: string): Db {
  const e = env();
  return createClient(e.SUPABASE_URL, e.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

export class DbError extends Error {
  constructor(
    message: string,
    public readonly status: number = 500,
    public readonly detalle?: unknown,
  ) {
    super(message);
  }
}

/** Convierte un PostgrestError en DbError con status HTTP razonable. */
export function throwIf(error: { message: string; code?: string; details?: string } | null): void {
  if (!error) return;
  if (error.code === 'PGRST116') throw new DbError('No encontrado', 404, error);
  if (error.code === '23505') throw new DbError('Registro duplicado', 409, error);
  if (error.code === '23514' || error.message.includes('No se puede abrir visibilidad')) {
    throw new DbError(error.message, 422, error);
  }
  if (error.code === '42501') throw new DbError('Sin permisos', 403, error);
  throw new DbError(error.message, 500, error);
}
