/** Consultas de la importación de Basecamp (lib/basecamp/importar.ts). */
import type { Requerimiento } from '@backio/shared';
import { type DbCtx, type FilaUpdate, serviceClient, throwIf } from './client';
import { paginar } from './paginar';
import type { Enlazado, FilaDesdeTodo } from '../basecamp/decisiones';

export interface ProyectoEnlazado {
  id: string;
  nombre?: string;
  basecamp_todolist_id: number | null;
  basecamp_grupos: Record<string, number>;
}

export async function proyectosDeCliente(ctx: DbCtx, clienteId: string): Promise<ProyectoEnlazado[]> {
  const { data, error } = await ctx.db
    .from('proyectos')
    .select('id, nombre, basecamp_todolist_id, basecamp_grupos')
    .eq('tenant_id', ctx.tenantId)
    .eq('cliente_id', clienteId)
    .is('deleted_at', null);
  throwIf(error);
  return (data ?? []) as ProyectoEnlazado[];
}

/** Requerimientos del cliente enlazados a un to-do. Paginado (B6: antes se cortaba en 1000). */
export function enlazadosDeCliente(ctx: DbCtx, clienteId: string): Promise<Enlazado[]> {
  return paginar<Enlazado>((a, b) =>
    ctx.db
      .from('requerimientos')
      .select('id, basecamp_todo_id, owner_agencia, titulo_interno, bloque_nombre, proyecto_id, estado_operativo')
      .eq('tenant_id', ctx.tenantId)
      .eq('cliente_id', clienteId)
      .not('basecamp_todo_id', 'is', null)
      .is('deleted_at', null)
      .order('id')
      .range(a, b),
  );
}

/** To-dos que alguien descartó como huérfanos: la importación no los vuelve a crear (B6). */
export async function todosIgnorados(ctx: DbCtx): Promise<Set<number>> {
  const filas = await paginar<{ basecamp_todo_id: number }>((a, b) =>
    ctx.db
      .from('basecamp_huerfanos')
      .select('basecamp_todo_id')
      .eq('tenant_id', ctx.tenantId)
      .eq('resolucion', 'ignorado')
      .order('basecamp_todo_id')
      .range(a, b),
  );
  return new Set(filas.map((f) => f.basecamp_todo_id));
}

/**
 * Inserta un requerimiento ya enlazado a su to-do. Si otro proceso lo creó primero (índice único sobre
 * basecamp_todo_id), devuelve null en lugar de duplicarlo.
 */
export async function insertarEnlazado(ctx: DbCtx, fila: FilaDesdeTodo): Promise<Requerimiento | null> {
  const { data, error } = await ctx.db
    .from('requerimientos')
    .insert({ ...fila, tenant_id: ctx.tenantId, created_by: ctx.usuarioId, updated_by: ctx.usuarioId })
    .select()
    .single();
  if (error?.code === '23505') return null;
  throwIf(error);
  return data as Requerimiento;
}

export async function actualizarEnlazado(ctx: DbCtx, id: string, patch: FilaUpdate<'requerimientos'>): Promise<void> {
  const { error } = await ctx.db.from('requerimientos').update(patch).eq('id', id).eq('tenant_id', ctx.tenantId);
  throwIf(error);
}

export async function marcarHuerfanosAdoptados(ctx: DbCtx, todoIds: number[]): Promise<void> {
  if (!todoIds.length) return;
  const { error } = await ctx.db
    .from('basecamp_huerfanos')
    .update({ resuelto_at: new Date().toISOString(), resolucion: 'adoptado' })
    .eq('tenant_id', ctx.tenantId)
    .is('resuelto_at', null)
    .in('basecamp_todo_id', todoIds);
  // No detiene la importación: las tareas ya quedaron creadas; la bandeja de huérfanos se corrige en la siguiente.
  if (error) console.error('[importar] huérfanos adoptados', error.message);
}

/** Marca del sistema: con service role, porque con la migración 27 solo admin escribe en clientes con su sesión. */
export async function marcarClienteImportado(ctx: DbCtx, clienteId: string): Promise<void> {
  const { error } = await serviceClient()
    .from('clientes')
    .update({ basecamp_importado_at: new Date().toISOString() })
    .eq('id', clienteId)
    .eq('tenant_id', ctx.tenantId);
  if (error) console.error('[importar] marca de importado', clienteId, error.message);
}
