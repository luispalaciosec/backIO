/** Horas del timesheet de Basecamp (`horas`): solo números e ids, nunca la descripción. */
import { type DbCtx, type FilaInsert, throwIf } from './client';
import { paginar } from './paginar';

/** Requerimientos enlazados a un to-do (id y to-do). Paginado: PostgREST corta en 1000 filas. */
export async function listRequerimientosConTodo(ctx: DbCtx): Promise<{ id: string; basecamp_todo_id: number }[]> {
  return paginar<{ id: string; basecamp_todo_id: number }>((desde, hasta) =>
    ctx.db
      .from('requerimientos')
      .select('id, basecamp_todo_id')
      .eq('tenant_id', ctx.tenantId)
      .not('basecamp_todo_id', 'is', null)
      .order('id')
      .range(desde, hasta),
  );
}

/** Upsert por (tenant, entrada de Basecamp). Devuelve cuántas filas quedaron guardadas. */
export async function upsertHoras(ctx: DbCtx, filas: FilaInsert<'horas'>[]): Promise<number> {
  const { data, error } = await ctx.db.from('horas').upsert(filas, { onConflict: 'tenant_id,basecamp_entry_id' }).select('id');
  throwIf(error);
  return (data ?? []).length;
}

export interface FilaHoras {
  cliente_id: string;
  usuario_id: string | null;
  requerimiento_id: string | null;
  horas: number;
  requerimientos: { proyecto_id: string | null } | null;
}

/** Horas desde una fecha (YYYY-MM-DD), con el proyecto de su requerimiento; opcionalmente de ciertos clientes. */
export async function listHorasDesde(ctx: DbCtx, desde: string, clienteIds?: string[]): Promise<FilaHoras[]> {
  // Paginado: 30 días de horas de todo el equipo pasan pronto de 1000 filas y los totales salían bajos sin aviso.
  return paginar<FilaHoras>((a, b) => {
    let q = ctx.db
      .from('horas')
      .select('cliente_id, usuario_id, requerimiento_id, horas, requerimientos(proyecto_id)')
      .eq('tenant_id', ctx.tenantId)
      .gte('fecha', desde);
    if (clienteIds?.length) q = q.in('cliente_id', clienteIds);
    return q.order('id').range(a, b);
  });
}

/** Horas de un requerimiento desde una fecha (YYYY-MM-DD). Si la consulta falla devuelve []. */
export async function listHorasRequerimientoDesde(ctx: DbCtx, requerimientoId: string, desde: string): Promise<{ horas: number }[]> {
  const { data: horas } = await ctx.db
    .from('horas')
    .select('horas')
    .eq('tenant_id', ctx.tenantId)
    .eq('requerimiento_id', requerimientoId)
    .gte('fecha', desde);
  return (horas ?? []) as { horas: number }[];
}
