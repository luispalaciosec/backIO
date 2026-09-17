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

export interface ResultadoImport { listas: number; proyectos_creados: number; requerimientos_creados: number; ya_enlazados: number; omitidos_completados_viejos: number; responsables_actualizados: number; titulos_actualizados: number; movidos: number; proyectos_renombrados: number; eliminados_en_basecamp: number }

/**
 * Importa y SINCRONIZA la estructura del proyecto Basecamp de un cliente:
 *  - to-dos nuevos → requerimientos (salvo `soloActualizar`, que los deja al flujo de huérfanos);
 *  - en los ya enlazados: título (excepción D1), grupo → bloque, lista → proyecto (movimientos), responsables;
 *  - listas renombradas → nombre del proyecto;
 *  - to-dos eliminados/archivados en Basecamp → requerimiento cancelado (queda en historial).
 * Nunca entran descripciones ni comentarios.
 */
export async function importarBasecampCliente(ctx: DbCtx, clienteId: string, opts: { incluirCompletados?: boolean; diasCompletados?: number; soloActualizar?: boolean } = {}): Promise<ResultadoImport> {
  const cliente = await getCliente(ctx, clienteId);
  if (!cliente?.basecamp_project_id) throw new Error('Cliente sin proyecto Basecamp');
  const bc = await BasecampClient.forTenant(ctx.tenantId);
  const usuarios = await listUsuarios(ctx);
  const porBcUser = new Map(usuarios.filter((u) => u.basecamp_user_id).map((u) => [u.basecamp_user_id as number, u.id]));
  const todosetId = await bc.getTodosetId(cliente.basecamp_project_id);
  const listas = await bc.listTodolists(cliente.basecamp_project_id, todosetId);

  const { data: existentesP } = await ctx.db.from('proyectos').select('id, nombre, basecamp_todolist_id, basecamp_grupos').eq('tenant_id', ctx.tenantId).eq('cliente_id', clienteId).is('deleted_at', null);
  type P = { id: string; nombre?: string; basecamp_todolist_id: number | null; basecamp_grupos: Record<string, number> };
  const proyectoPorLista = new Map(((existentesP ?? []) as P[]).filter((p) => p.basecamp_todolist_id).map((p) => [p.basecamp_todolist_id as number, p]));
  const { data: existentesR } = await ctx.db.from('requerimientos').select('id, basecamp_todo_id, owner_agencia, titulo_interno, bloque_nombre, proyecto_id, estado_operativo').eq('tenant_id', ctx.tenantId).eq('cliente_id', clienteId).not('basecamp_todo_id', 'is', null).is('deleted_at', null);
  type RX = { id: string; basecamp_todo_id: number; owner_agencia: string[]; titulo_interno: string; bloque_nombre: string | null; proyecto_id: string | null; estado_operativo: string };
  const vistos = new Set<number>();
  const enlazadoPorTodo = new Map(((existentesR ?? []) as RX[]).map((x) => [x.basecamp_todo_id, x]));
  const yaEnlazados = new Set(enlazadoPorTodo.keys());

  const limiteCompletados = Date.now() - (opts.diasCompletados ?? 60) * 86_400_000;
  const r: ResultadoImport = { listas: listas.length, proyectos_creados: 0, requerimientos_creados: 0, ya_enlazados: 0, omitidos_completados_viejos: 0, responsables_actualizados: 0, titulos_actualizados: 0, movidos: 0, proyectos_renombrados: 0, eliminados_en_basecamp: 0 };

  for (const lista of listas) {
    const grupos = await bc.listGroups(cliente.basecamp_project_id, lista.id);
    type Todo = Awaited<ReturnType<typeof bc.listTodosSafe>>[number] & { bloque: string | null; grupoId: number | null };
    const todosPlanos: Todo[] = [];
    for (const t of await bc.listTodosSafe(cliente.basecamp_project_id, lista.id, opts.incluirCompletados ?? true)) todosPlanos.push({ ...t, bloque: null, grupoId: null });
    for (const g of grupos) for (const t of await bc.listTodosSafe(cliente.basecamp_project_id, g.id, opts.incluirCompletados ?? true)) todosPlanos.push({ ...t, bloque: g.name, grupoId: g.id });

    for (const t of todosPlanos) vistos.add(t.id);
    // Lista renombrada en Basecamp → nombre del proyecto.
    const pExist = proyectoPorLista.get(lista.id);
    if (pExist && pExist.nombre !== undefined && pExist.nombre !== lista.name && lista.name) {
      await updateProyecto(ctx, pExist.id, { nombre: lista.name, basecamp_grupos: Object.fromEntries(grupos.map((g) => [g.name, g.id])) });
      pExist.nombre = lista.name; r.proyectos_renombrados += 1;
    }
    const nuevos = opts.soloActualizar ? [] : todosPlanos.filter((t) => !yaEnlazados.has(t.id));
    const filtrados = nuevos.filter((t) => !(t.completed && t.completed_at && new Date(t.completed_at).getTime() < limiteCompletados));
    r.ya_enlazados += todosPlanos.length - nuevos.length;
    // Reimportación: completar responsables de to-dos ya enlazados que quedaron sin owner
    // (p. ej. porque los usuarios aún no tenían basecamp_user_id al importar).
    for (const t of todosPlanos) {
      const ex = enlazadoPorTodo.get(t.id);
      if (!ex) continue;
      const patch: Record<string, unknown> = {};
      // Título (excepción D1) y grupo → bloque.
      if (t.titulo && t.titulo !== ex.titulo_interno) { patch.titulo_interno = t.titulo; r.titulos_actualizados += 1; }
      if ((t.bloque ?? null) !== (ex.bloque_nombre ?? null)) patch.bloque_nombre = t.bloque;
      // To-do movido a otra lista → otro proyecto.
      const pDestino = proyectoPorLista.get(lista.id);
      if (pDestino && ex.proyecto_id !== pDestino.id) { patch.proyecto_id = pDestino.id; patch.basecamp_todolist_id = t.grupoId ?? lista.id; r.movidos += 1; }
      // Responsables: los asignados en Basecamp que tienen usuario en BackIO.
      const owners = t.assignee_ids.map((id) => porBcUser.get(id)).filter((x): x is string => !!x);
      const igual = owners.length === ex.owner_agencia.length && owners.every((o) => ex.owner_agencia.includes(o));
      if (owners.length && !igual) { patch.owner_agencia = owners; r.responsables_actualizados += 1; }
      if (Object.keys(patch).length) { const { error } = await ctx.db.from('requerimientos').update(patch).eq('id', ex.id); throwIf(error); }
    }
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
  // To-dos enlazados y abiertos que ya no aparecen en ninguna lista: se verifica uno a uno y, si Basecamp
  // los tiene en la papelera o archivados (o ya no existen), el requerimiento se cancela.
  for (const ex of enlazadoPorTodo.values()) {
    if (vistos.has(ex.basecamp_todo_id) || ex.estado_operativo === 'completado' || ex.estado_operativo === 'cancelado') continue;
    let eliminado = false;
    try {
      const raw = (await bc.getTodoRaw(cliente.basecamp_project_id, ex.basecamp_todo_id)) as { status?: string } | null;
      eliminado = !raw || raw.status === 'trashed' || raw.status === 'archived';
    } catch (err) { eliminado = /\b404\b/.test(err instanceof Error ? err.message : ''); }
    if (!eliminado) continue;
    const { error } = await ctx.db.from('requerimientos').update({ estado_operativo: 'cancelado', daily_fecha: null }).eq('id', ex.id);
    throwIf(error);
    await audit(ctx, { accion: 'basecamp_eliminado', entidad: 'requerimiento', entidad_id: ex.id, detalle: { todo_id: ex.basecamp_todo_id, titulo: ex.titulo_interno } });
    r.eliminados_en_basecamp += 1;
  }
  await ctx.db.from('clientes').update({ basecamp_importado_at: new Date().toISOString() }).eq('id', clienteId);
  await audit(ctx, { accion: 'basecamp_importar', entidad: 'cliente', entidad_id: clienteId, detalle: r });
  return r;
}
