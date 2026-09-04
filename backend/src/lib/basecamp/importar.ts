/**
 * Importación única de las listas de to-dos existentes en el proyecto Basecamp de un cliente (sprint 3).
 * Excepción D1 (aprobada por Luis 04/09/2026): entra el TÍTULO del to-do como titulo_interno, nunca visible
 * al cliente (visible_cliente=false, sin etiqueta). No entran descripciones, comentarios ni adjuntos.
 * Idempotente: se enlaza por basecamp_todo_id / basecamp_todolist_id.
 */
import type { DbCtx } from '../db/client';
import { throwIf } from '../db/client';
import { getCliente } from '../db/clientes';
import { listUsuarios } from '../db/usuarios';
import { insertProyecto, updateProyecto } from '../db/proyectos';
import { insertRequerimientos } from '../db/requerimientos';
import { audit } from '../db/audit';
import { generarPortalToken } from '../portal/token';
import { BasecampClient } from './client';

export interface ResultadoImport { listas: number; proyectos_creados: number; requerimientos_creados: number; ya_enlazados: number; omitidos_completados_viejos: number }

export async function importarBasecampCliente(ctx: DbCtx, clienteId: string, opts: { incluirCompletados?: boolean; diasCompletados?: number } = {}): Promise<ResultadoImport> {
  const cliente = await getCliente(ctx, clienteId);
  if (!cliente?.basecamp_project_id) throw new Error('Cliente sin proyecto Basecamp');
  const bc = await BasecampClient.forTenant(ctx.tenantId);
  const usuarios = await listUsuarios(ctx);
  const porBcUser = new Map(usuarios.filter((u) => u.basecamp_user_id).map((u) => [u.basecamp_user_id as number, u.id]));
  const todosetId = await bc.getTodosetId(cliente.basecamp_project_id);
  const listas = await bc.listTodolists(cliente.basecamp_project_id, todosetId);

  const { data: existentesP } = await ctx.db.from('proyectos').select('id, basecamp_todolist_id, basecamp_grupos').eq('tenant_id', ctx.tenantId).eq('cliente_id', clienteId).is('deleted_at', null);
  type P = { id: string; basecamp_todolist_id: number | null; basecamp_grupos: Record<string, number> };
  const proyectoPorLista = new Map(((existentesP ?? []) as P[]).filter((p) => p.basecamp_todolist_id).map((p) => [p.basecamp_todolist_id as number, p]));
  const { data: existentesR } = await ctx.db.from('requerimientos').select('basecamp_todo_id').eq('tenant_id', ctx.tenantId).eq('cliente_id', clienteId).not('basecamp_todo_id', 'is', null);
  const yaEnlazados = new Set(((existentesR ?? []) as { basecamp_todo_id: number }[]).map((r) => r.basecamp_todo_id));

  const limiteCompletados = Date.now() - (opts.diasCompletados ?? 60) * 86_400_000;
  const r: ResultadoImport = { listas: listas.length, proyectos_creados: 0, requerimientos_creados: 0, ya_enlazados: 0, omitidos_completados_viejos: 0 };

  for (const lista of listas) {
    const grupos = await bc.listGroups(cliente.basecamp_project_id, lista.id);
    type Todo = Awaited<ReturnType<typeof bc.listTodosSafe>>[number] & { bloque: string | null; grupoId: number | null };
    const todosPlanos: Todo[] = [];
    for (const t of await bc.listTodosSafe(cliente.basecamp_project_id, lista.id, opts.incluirCompletados ?? true)) todosPlanos.push({ ...t, bloque: null, grupoId: null });
    for (const g of grupos) for (const t of await bc.listTodosSafe(cliente.basecamp_project_id, g.id, opts.incluirCompletados ?? true)) todosPlanos.push({ ...t, bloque: g.name, grupoId: g.id });

    const nuevos = todosPlanos.filter((t) => !yaEnlazados.has(t.id));
    const filtrados = nuevos.filter((t) => !(t.completed && t.completed_at && new Date(t.completed_at).getTime() < limiteCompletados));
    r.ya_enlazados += todosPlanos.length - nuevos.length;
    r.omitidos_completados_viejos += nuevos.length - filtrados.length;
    if (filtrados.length === 0 && (proyectoPorLista.has(lista.id) || todosPlanos.length === 0)) continue;

    let proyecto = proyectoPorLista.get(lista.id);
    if (!proyecto) {
      const fechas = todosPlanos.map((t) => t.due_on).filter((d): d is string => !!d).sort();
      const hoy = new Date().toISOString().slice(0, 10);
      const entrega = fechas[fechas.length - 1] ?? new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
      const inicio = fechas[0] && fechas[0] < entrega ? fechas[0] : hoy < entrega ? hoy : entrega;
      const p = await insertProyecto(ctx, { cliente_id: clienteId, plantilla_id: null, nombre: lista.name, brief: { origen: 'importacion_basecamp' }, fecha_inicio: inicio, fecha_entrega: entrega, portal_token: generarPortalToken() });
      const grupoMap = Object.fromEntries(grupos.map((g) => [g.name, g.id]));
      const todoHecho = todosPlanos.length > 0 && todosPlanos.every((t) => t.completed);
      await updateProyecto(ctx, p.id, { basecamp_todolist_id: lista.id, basecamp_todoset_id: todosetId, basecamp_grupos: grupoMap, sync_estado: 'ok', estado: todoHecho ? 'completado' : 'en_ejecucion' });
      proyecto = { id: p.id, basecamp_todolist_id: lista.id, basecamp_grupos: grupoMap };
      proyectoPorLista.set(lista.id, proyecto);
      r.proyectos_creados += 1;
    }

    if (filtrados.length) {
      const creados = await insertRequerimientos(ctx, filtrados.map((t) => ({
        cliente_id: clienteId, proyecto_id: proyecto!.id, bloque_nombre: t.bloque,
        titulo_interno: t.titulo || `To-do ${t.id}`, etiqueta_cliente: null, visible_cliente: false,
        tipo_trabajo: 'fee', estado_operativo: t.completed ? 'completado' : (t.due_on ? 'priorizado' : 'backlog'),
        prioridad: 'media', peso: 1, fecha_pedido: t.created_at ? t.created_at.slice(0, 10) : null, fecha_entrega: t.due_on,
        owner_agencia: t.assignee_ids.map((id) => porBcUser.get(id)).filter((x): x is string => !!x), piezas: 0,
      })));
      for (const [i, req] of creados.entries()) {
        const t = filtrados[i]!;
        const { error } = await ctx.db.from('requerimientos').update({ basecamp_todo_id: t.id, basecamp_todolist_id: t.grupoId ?? lista.id, basecamp_url: t.app_url, completado_at: t.completed ? t.completed_at : null }).eq('id', req.id);
        throwIf(error);
        yaEnlazados.add(t.id);
      }
      r.requerimientos_creados += creados.length;
    }
  }
  await ctx.db.from('clientes').update({ basecamp_importado_at: new Date().toISOString() }).eq('id', clienteId);
  await audit(ctx, { accion: 'basecamp_importar', entidad: 'cliente', entidad_id: clienteId, detalle: r });
  return r;
}
