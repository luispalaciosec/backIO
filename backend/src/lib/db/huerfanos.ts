/** To-dos de Basecamp creados fuera de BackIO (`basecamp_huerfanos`) y los enlaces que usa su detector. */
import { type DbCtx, type FilaInsert, throwIf } from './client';
import { paginar } from './paginar';

export interface Huerfano {
  id: string;
  cliente_id: string;
  basecamp_project_id: number;
  basecamp_todolist_id: number | null;
  basecamp_todo_id: number;
  titulo: string;
  creador_nombre: string | null;
  creador_basecamp_id: number | null;
  due_on: string | null;
  completed: boolean;
  app_url: string | null;
  detectado_at: string;
  resuelto_at: string | null;
  resolucion: string | null;
}

/** Ids de to-do ya enlazados a un requerimiento (incluye eliminados). Paginado: PostgREST corta en 1000 filas. */
export async function listTodoIdsEnlazados(ctx: DbCtx): Promise<number[]> {
  return (
    await paginar<{ basecamp_todo_id: number }>((desde, hasta) =>
      ctx.db
        .from('requerimientos')
        .select('basecamp_todo_id')
        .eq('tenant_id', ctx.tenantId)
        .not('basecamp_todo_id', 'is', null)
        .order('id')
        .range(desde, hasta),
    )
  ).map((r) => r.basecamp_todo_id);
}

/** Huérfanos sin resolver (id y to-do). Si la consulta falla devuelve []. */
export async function listHuerfanosPendientesTodo(ctx: DbCtx): Promise<{ id: string; basecamp_todo_id: number }[]> {
  const { data } = await ctx.db
    .from('basecamp_huerfanos')
    .select('id, basecamp_todo_id')
    .eq('tenant_id', ctx.tenantId)
    .is('resuelto_at', null);
  return (data ?? []) as { id: string; basecamp_todo_id: number }[];
}

/** Cierra como adoptados los huérfanos indicados (sin propagar error). */
export async function marcarHuerfanosAdoptados(ctx: DbCtx, ids: string[]): Promise<void> {
  await ctx.db
    .from('basecamp_huerfanos')
    .update({ resuelto_at: new Date().toISOString(), resolucion: 'adoptado' })
    .eq('tenant_id', ctx.tenantId)
    .in('id', ids);
}

/** Ids de to-do ya registrados como huérfanos, resueltos o no. Si la consulta falla devuelve []. */
export async function listTodoIdsHuerfanos(ctx: DbCtx): Promise<number[]> {
  const { data: previos } = await ctx.db.from('basecamp_huerfanos').select('basecamp_todo_id').eq('tenant_id', ctx.tenantId);
  return ((previos ?? []) as { basecamp_todo_id: number }[]).map((h) => h.basecamp_todo_id);
}

export async function insertHuerfanos(ctx: DbCtx, filas: FilaInsert<'basecamp_huerfanos'>[]): Promise<void> {
  const { error } = await ctx.db.from('basecamp_huerfanos').insert(filas);
  throwIf(error);
}

export async function contarHuerfanosPendientes(ctx: DbCtx): Promise<number | null> {
  const { count } = await ctx.db
    .from('basecamp_huerfanos')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', ctx.tenantId)
    .is('resuelto_at', null);
  return count;
}

export async function listHuerfanos(ctx: DbCtx, soloPendientes = true): Promise<Huerfano[]> {
  let q = ctx.db.from('basecamp_huerfanos').select('*').eq('tenant_id', ctx.tenantId).order('detectado_at', { ascending: false });
  if (soloPendientes) q = q.is('resuelto_at', null);
  const { data, error } = await q.limit(500);
  throwIf(error);
  return (data ?? []) as Huerfano[];
}

export async function getHuerfano(ctx: DbCtx, id: string): Promise<Huerfano> {
  const { data, error } = await ctx.db.from('basecamp_huerfanos').select('*').eq('tenant_id', ctx.tenantId).eq('id', id).single();
  throwIf(error);
  return data as Huerfano;
}

/** Requerimiento (vivo o eliminado) enlazado a un to-do. Si la consulta falla devuelve null. */
export async function getRequerimientoPorTodo(ctx: DbCtx, todoId: number): Promise<{ id: string; deleted_at: string | null } | null> {
  const { data: exist } = await ctx.db
    .from('requerimientos')
    .select('id, deleted_at')
    .eq('tenant_id', ctx.tenantId)
    .eq('basecamp_todo_id', todoId)
    .maybeSingle();
  return (exist as { id: string; deleted_at: string | null } | null) ?? null;
}

/** Quita el borrado lógico de un requerimiento (sin propagar error). */
export async function restaurarRequerimiento(ctx: DbCtx, id: string): Promise<void> {
  await ctx.db.from('requerimientos').update({ deleted_at: null }).eq('id', id).eq('tenant_id', ctx.tenantId);
}

/** Borrado lógico de un requerimiento (sin propagar error). */
export async function descartarRequerimiento(ctx: DbCtx, id: string): Promise<void> {
  await ctx.db.from('requerimientos').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('tenant_id', ctx.tenantId);
}

/** Proyectos vivos de un cliente con sus listas y grupos de Basecamp. Si la consulta falla devuelve []. */
export async function listProyectosListasCliente(
  ctx: DbCtx,
  clienteId: string,
): Promise<{ id: string; basecamp_todolist_id: number | null; basecamp_grupos: Record<string, number> }[]> {
  const { data: pg } = await ctx.db
    .from('proyectos')
    .select('id, basecamp_todolist_id, basecamp_grupos')
    .eq('tenant_id', ctx.tenantId)
    .eq('cliente_id', clienteId)
    .is('deleted_at', null);
  return (pg ?? []) as { id: string; basecamp_todolist_id: number | null; basecamp_grupos: Record<string, number> }[];
}

/** Enlaza un requerimiento a su to-do. Devuelve el error para que el llamador decida (no lanza). */
export async function enlazarRequerimientoTodo(
  ctx: DbCtx,
  requerimientoId: string,
  enlace: { basecamp_todo_id: number; basecamp_todolist_id: number | null; basecamp_url: string | null },
): Promise<{ message: string } | null> {
  const { error } = await ctx.db.from('requerimientos').update(enlace).eq('tenant_id', ctx.tenantId).eq('id', requerimientoId);
  return error;
}

/** Marca un huérfano como adoptado por un requerimiento (sin propagar error). */
export async function marcarHuerfanoAdoptado(ctx: DbCtx, id: string, requerimientoId: string): Promise<void> {
  await ctx.db
    .from('basecamp_huerfanos')
    .update({ resuelto_at: new Date().toISOString(), resolucion: 'adoptado', requerimiento_id: requerimientoId })
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId);
}

export async function marcarHuerfanoIgnorado(ctx: DbCtx, id: string): Promise<void> {
  const { error } = await ctx.db
    .from('basecamp_huerfanos')
    .update({ resuelto_at: new Date().toISOString(), resolucion: 'ignorado' })
    .eq('tenant_id', ctx.tenantId)
    .eq('id', id);
  throwIf(error);
}
