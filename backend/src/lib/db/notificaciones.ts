/** Cola de notificaciones por correo (lib/notificaciones). Service role: la usan rutas, cron y el scheduler. */
import type { Rol } from '@backio/shared';
import { serviceClient, throwIf, type DbCtx, type FilaInsert } from './client';

/** Usuarios activos del tenant con esos ids. */
export async function usuariosActivosPorId(tenantId: string, ids: string[]): Promise<{ id: string; email: string }[]> {
  const { data } = await serviceClient().from('usuarios').select('id, email').eq('tenant_id', tenantId).eq('activo', true).in('id', ids);
  return (data ?? []) as { id: string; email: string }[];
}

/** Usuarios activos del tenant con alguno de esos roles. */
export async function usuariosActivosPorRol(tenantId: string, roles: Rol[]): Promise<{ id: string; email: string }[]> {
  const { data } = await serviceClient().from('usuarios').select('id, email').eq('tenant_id', tenantId).eq('activo', true).in('rol', roles);
  return (data ?? []) as { id: string; email: string }[];
}

export async function insertarNotificaciones(filas: FilaInsert<'notificaciones'>[]): Promise<{ id: string }[]> {
  const { data, error } = await serviceClient().from('notificaciones').insert(filas).select('id');
  throwIf(error);
  return data ?? [];
}

/** Correos sin enviar con intentos disponibles, los más antiguos primero (50 por pasada). */
export async function listarNotificacionesPendientes(maxIntentos: number, tenantId?: string) {
  let q = serviceClient()
    .from('notificaciones')
    .select('id, tenant_id, usuario_id, email_destino, titulo, cuerpo, intentos')
    .eq('canal', 'email')
    .is('enviada_at', null)
    .lt('intentos', maxIntentos)
    .order('created_at')
    .limit(50);
  if (tenantId) q = q.eq('tenant_id', tenantId);
  const { data, error } = await q;
  throwIf(error);
  return data ?? [];
}

/** Correo actual, tenant y estado de los usuarios dueños de las filas. */
export async function correosDeUsuarios(
  ids: string[],
): Promise<{ id: string; email: string | null; tenant_id: string; activo: boolean }[]> {
  const { data, error } = await serviceClient().from('usuarios').select('id, email, tenant_id, activo').in('id', ids);
  throwIf(error);
  return (data ?? []) as { id: string; email: string | null; tenant_id: string; activo: boolean }[];
}

/** Agota los intentos de una fila sin destinatario válido. */
export async function descartarNotificacion(id: string, maxIntentos: number): Promise<void> {
  await serviceClient().from('notificaciones').update({ intentos: maxIntentos, ultimo_error: 'sin destinatario válido' }).eq('id', id);
}

/**
 * Reserva la fila subiendo `intentos` de N a N+1 solo si sigue en N y sin enviar (update condicional). Devuelve las
 * filas reservadas: vacío si otro proceso la tomó antes.
 */
export async function reservarNotificacion(id: string, intentos: number): Promise<{ id: string }[] | null> {
  const { data, error } = await serviceClient()
    .from('notificaciones')
    .update({ intentos: intentos + 1 })
    .eq('id', id)
    .eq('intentos', intentos)
    .is('enviada_at', null)
    .select('id');
  throwIf(error);
  return data;
}

export async function marcarNotificacionEnviada(id: string): Promise<void> {
  await serviceClient().from('notificaciones').update({ enviada_at: new Date().toISOString(), ultimo_error: null }).eq('id', id);
}

export async function registrarErrorNotificacion(id: string, ultimoError: string): Promise<void> {
  await serviceClient().from('notificaciones').update({ ultimo_error: ultimoError }).eq('id', id);
}

/** Avisos de la persona (su campana): los de los últimos 30 días, los nuevos primero. RLS: solo los propios. */
export async function listarMisNotificaciones(ctx: DbCtx, dias = 30) {
  const { data, error } = await ctx.db
    .from('notificaciones')
    .select('id, tipo, titulo, cuerpo, created_at, leida_at')
    .eq('tenant_id', ctx.tenantId)
    .eq('usuario_id', ctx.usuarioId ?? '')
    .gte('created_at', new Date(Date.now() - dias * 86_400_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(50);
  throwIf(error);
  return data ?? [];
}

/** Marca como leídos (uno o todos los no leídos). El trigger notificaciones_solo_leida solo deja tocar leida_at. */
export async function marcarLeidas(ctx: DbCtx, id?: string): Promise<void> {
  let q = ctx.db
    .from('notificaciones')
    .update({ leida_at: new Date().toISOString() })
    .eq('tenant_id', ctx.tenantId)
    .eq('usuario_id', ctx.usuarioId ?? '')
    .is('leida_at', null);
  if (id) q = q.eq('id', id);
  const { error } = await q;
  throwIf(error);
}
