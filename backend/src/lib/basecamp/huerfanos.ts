/**
 * Detector de to-dos creados fuera de BackIO (regla de entrada: cliente → BackIO → Basecamp).
 * Recorre las listas activas de cada cliente ya importado y registra los to-dos cuyo id no existe en
 * requerimientos. Solo título (excepción D1), creador, fecha y estado.
 */
import type { DbCtx } from '../db/client';
import { throwIf } from '../db/client';
import { listClientes } from '../db/clientes';
import { getProyecto } from '../db/proyectos';
import { insertRequerimientos } from '../db/requerimientos';
import { listUsuarios } from '../db/usuarios';
import { audit } from '../db/audit';
import { notificar } from '../notificaciones';
import { BasecampClient } from './client';

export interface Huerfano {
  id: string; cliente_id: string; basecamp_project_id: number; basecamp_todolist_id: number | null; basecamp_todo_id: number;
  titulo: string; creador_nombre: string | null; creador_basecamp_id: number | null; due_on: string | null; completed: boolean; app_url: string | null; detectado_at: string; resuelto_at: string | null; resolucion: string | null;
}

export async function detectarHuerfanos(ctx: DbCtx, opts: { notificar?: boolean } = {}): Promise<{ clientes: number; nuevos: number; pendientes: number }> {
  const clientes = (await listClientes(ctx)).filter((c) => c.basecamp_project_id && c.basecamp_importado_at);
  if (clientes.length === 0) return { clientes: 0, nuevos: 0, pendientes: 0 };
  const bc = await BasecampClient.forTenant(ctx.tenantId);
  const { data: enlazados } = await ctx.db.from('requerimientos').select('basecamp_todo_id').eq('tenant_id', ctx.tenantId).not('basecamp_todo_id', 'is', null);
  const conocidos = new Set(((enlazados ?? []) as { basecamp_todo_id: number }[]).map((r) => r.basecamp_todo_id));
  const { data: previos } = await ctx.db.from('basecamp_huerfanos').select('basecamp_todo_id').eq('tenant_id', ctx.tenantId);
  const yaRegistrados = new Set(((previos ?? []) as { basecamp_todo_id: number }[]).map((h) => h.basecamp_todo_id));

  let nuevos = 0;
  for (const c of clientes) {
    const pid = c.basecamp_project_id as number;
    try {
      const todoset = await bc.getTodosetId(pid);
      const listas = await bc.listTodolists(pid, todoset);
      for (const lista of listas) {
        const fuentes = [{ id: lista.id }, ...(await bc.listGroups(pid, lista.id))];
        for (const f of fuentes) {
          const todos = await bc.listTodosSafe(pid, f.id, false);
          const huerfanos = todos.filter((t) => !conocidos.has(t.id) && !yaRegistrados.has(t.id));
          if (!huerfanos.length) continue;
          const { error } = await ctx.db.from('basecamp_huerfanos').insert(huerfanos.map((t) => ({
            tenant_id: ctx.tenantId, cliente_id: c.id, basecamp_project_id: pid, basecamp_todolist_id: f.id, basecamp_todo_id: t.id,
            titulo: t.titulo || `To-do ${t.id}`, creador_basecamp_id: t.creator_id, creador_nombre: t.creator_nombre, due_on: t.due_on, completed: t.completed, app_url: t.app_url,
          })));
          throwIf(error);
          huerfanos.forEach((t) => yaRegistrados.add(t.id));
          nuevos += huerfanos.length;
        }
      }
    } catch (err) {
      console.error('[huerfanos] cliente', c.nombre, err instanceof Error ? err.message : err);
    }
  }
  const { count } = await ctx.db.from('basecamp_huerfanos').select('id', { count: 'exact', head: true }).eq('tenant_id', ctx.tenantId).is('resuelto_at', null);
  if (nuevos > 0 && opts.notificar !== false) {
    await notificar(ctx, {
      tipo: 'huerfanos', titulo: `${nuevos} to-do${nuevos === 1 ? '' : 's'} creado${nuevos === 1 ? '' : 's'} fuera de BackIO`,
      cuerpo: `Se detectaron ${nuevos} to-dos nuevos en Basecamp que no pasaron por BackIO. Pendientes de resolver: ${count ?? 0}. Adóptalos o ignóralos desde la pantalla Huérfanos.`,
      ruta: '/huerfanos',
    }, { roles: ['operaciones'] });
  }
  await audit(ctx, { accion: 'detectar_huerfanos', entidad: 'tenant', entidad_id: ctx.tenantId, detalle: { clientes: clientes.length, nuevos, pendientes: count ?? 0 } });
  return { clientes: clientes.length, nuevos, pendientes: count ?? 0 };
}

export async function listHuerfanos(ctx: DbCtx, soloPendientes = true): Promise<Huerfano[]> {
  let q = ctx.db.from('basecamp_huerfanos').select('*').eq('tenant_id', ctx.tenantId).order('detectado_at', { ascending: false });
  if (soloPendientes) q = q.is('resuelto_at', null);
  const { data, error } = await q.limit(500);
  throwIf(error);
  return (data ?? []) as Huerfano[];
}

/** Adopta un huérfano: lo convierte en requerimiento del proyecto de su lista (o del indicado). */
export async function adoptarHuerfano(ctx: DbCtx, id: string, proyectoId?: string | null): Promise<{ requerimiento_id: string }> {
  const { data, error } = await ctx.db.from('basecamp_huerfanos').select('*').eq('tenant_id', ctx.tenantId).eq('id', id).single();
  throwIf(error);
  const h = data as Huerfano;
  let pid = proyectoId ?? null;
  if (!pid && h.basecamp_todolist_id) {
    const { data: pg } = await ctx.db.from('proyectos').select('id, basecamp_todolist_id, basecamp_grupos').eq('tenant_id', ctx.tenantId).eq('cliente_id', h.cliente_id).is('deleted_at', null);
    const lista = h.basecamp_todolist_id;
    pid = ((pg ?? []) as { id: string; basecamp_todolist_id: number | null; basecamp_grupos: Record<string, number> }[])
      .find((x) => x.basecamp_todolist_id === lista || Object.values(x.basecamp_grupos ?? {}).includes(lista))?.id ?? null;
  }
  const proyecto = pid ? await getProyecto(ctx, pid) : null;
  const usuarios = await listUsuarios(ctx);
  const bloque = proyecto ? Object.entries(proyecto.basecamp_grupos ?? {}).find(([, gid]) => gid === h.basecamp_todolist_id)?.[0] ?? null : null;
  const [req] = await insertRequerimientos(ctx, [{
    cliente_id: h.cliente_id, proyecto_id: proyecto?.id ?? null, bloque_nombre: bloque, titulo_interno: h.titulo, etiqueta_cliente: null, visible_cliente: false,
    tipo_trabajo: 'fee', estado_operativo: h.completed ? 'completado' : (h.due_on ? 'priorizado' : 'backlog'), prioridad: 'media', peso: 1, fecha_entrega: h.due_on,
    owner_agencia: usuarios.filter((u) => u.basecamp_user_id === h.creador_basecamp_id).map((u) => u.id), piezas: 0,
  }]);
  if (!req) throw new Error('No se pudo crear el requerimiento');
  await ctx.db.from('requerimientos').update({ basecamp_todo_id: h.basecamp_todo_id, basecamp_todolist_id: h.basecamp_todolist_id, basecamp_url: h.app_url }).eq('id', req.id);
  await ctx.db.from('basecamp_huerfanos').update({ resuelto_at: new Date().toISOString(), resolucion: 'adoptado', requerimiento_id: req.id }).eq('id', id);
  await audit(ctx, { accion: 'adoptar_huerfano', entidad: 'requerimiento', entidad_id: req.id, detalle: { todo_id: h.basecamp_todo_id, proyecto_id: proyecto?.id ?? null } });
  return { requerimiento_id: req.id };
}

export async function ignorarHuerfano(ctx: DbCtx, id: string): Promise<void> {
  const { error } = await ctx.db.from('basecamp_huerfanos').update({ resuelto_at: new Date().toISOString(), resolucion: 'ignorado' }).eq('tenant_id', ctx.tenantId).eq('id', id);
  throwIf(error);
  await audit(ctx, { accion: 'ignorar_huerfano', entidad: 'huerfano', entidad_id: id });
}
