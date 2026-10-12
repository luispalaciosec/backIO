import { serviceClient, throwIf, DbError, type DbCtx } from './client';
import { paginar } from './paginar';

// Lo que tiene a su nombre una persona que se va. Lo lee un admin (su sesión ve todo el tenant por RLS).

export interface TareaDeSalida {
  id: string;
  titulo_interno: string;
  cliente_id: string;
  proyecto_id: string | null;
  fecha_entrega: string | null;
  estado_operativo: string;
  owner_agencia: string[];
  basecamp_todo_id: number | null;
  daily_fecha: string | null;
}

export async function tareasAbiertasDe(ctx: DbCtx, usuarioId: string): Promise<TareaDeSalida[]> {
  return paginar<TareaDeSalida>((from, to) =>
    ctx.db
      .from('requerimientos')
      .select('id, titulo_interno, cliente_id, proyecto_id, fecha_entrega, estado_operativo, owner_agencia, basecamp_todo_id, daily_fecha')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .not('estado_operativo', 'in', '("completado","cancelado")')
      .contains('owner_agencia', [usuarioId])
      .order('fecha_entrega', { nullsFirst: false })
      .order('id')
      .range(from, to),
  );
}

/** Proyectos: los abiertos donde la persona es ejecutiva, más los que se piden por id (para la mesa de sus tareas). */
export async function proyectosParaSalida(
  ctx: DbCtx,
  usuarioId: string,
  ids: string[],
): Promise<{ id: string; nombre: string; cliente_id: string; mesa_id: string | null; estado: string; owner_ejecutiva: string | null }[]> {
  const cols = 'id, nombre, cliente_id, mesa_id, estado, owner_ejecutiva';
  const [suyos, pedidos] = await Promise.all([
    ctx.db
      .from('proyectos')
      .select(cols)
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .not('estado', 'in', '("completado","cancelado")')
      .eq('owner_ejecutiva', usuarioId),
    ids.length
      ? ctx.db.from('proyectos').select(cols).eq('tenant_id', ctx.tenantId).in('id', ids)
      : Promise.resolve({ data: [], error: null }),
  ]);
  throwIf(suyos.error);
  throwIf(pedidos.error);
  const porId = new Map([...(pedidos.data ?? []), ...(suyos.data ?? [])].map((p) => [p.id, p]));
  return [...porId.values()];
}

export async function acuerdosPendientesDe(
  ctx: DbCtx,
  usuarioId: string,
): Promise<{ id: string; descripcion: string; fecha_compromiso: string }[]> {
  const { data, error } = await ctx.db
    .from('acuerdos')
    .select('id, descripcion, fecha_compromiso')
    .eq('tenant_id', ctx.tenantId)
    .eq('estado', 'pendiente')
    .eq('responsable_id', usuarioId)
    .order('fecha_compromiso');
  throwIf(error);
  return data ?? [];
}

/** API keys vivas creadas por la persona (se revocan en la salida). */
export async function contarApiKeysDe(ctx: DbCtx, usuarioId: string): Promise<number> {
  const { count, error } = await serviceClient()
    .from('api_keys')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', ctx.tenantId)
    .eq('creado_por', usuarioId)
    .is('revocada_at', null);
  throwIf(error);
  return count ?? 0;
}

export interface PlanSalidaRpc {
  tareas: { id: string; a: string | null; heredada: boolean }[];
  proyectos: { id: string; a: string | null }[];
  mesas: { id: string; a: string | null }[];
  acuerdos: { id: string; a: string }[];
  recurrencias: { id: string; a: string | null }[];
}

export interface ResultadoSalidaRpc {
  tareas: number;
  proyectos: number;
  mesas: number;
  acuerdos: number;
  recurrencias: number;
  api_keys_revocadas: number;
  tokens_oauth_borrados: number;
  codigos_oauth_borrados: number;
}

/** Todo en una transacción (migración 30). Falla con 422 si el plan no cubre lo que la persona tiene abierto. */
export async function registrarSalida(
  ctx: DbCtx,
  usuarioId: string,
  o: { fecha: string; motivo: string | null; plan: PlanSalidaRpc },
): Promise<ResultadoSalidaRpc> {
  const { data, error } = await serviceClient().rpc('salida_colaborador', {
    p_tenant: ctx.tenantId,
    p_usuario: usuarioId,
    p_actor: ctx.usuarioId,
    p_fecha: o.fecha,
    p_motivo: o.motivo,
    p_plan: o.plan as never,
  });
  if (error?.code === 'P0002') throw new DbError('Usuario no encontrado', 404);
  if (error?.code === '22023') throw new DbError(error.message, 422);
  throwIf(error);
  return data as unknown as ResultadoSalidaRpc;
}
