/**
 * Detector de to-dos creados fuera de BackIO (regla de entrada: cliente → BackIO → Basecamp).
 * Recorre las listas activas de cada cliente ya importado y registra los to-dos cuyo id no existe en
 * requerimientos. Solo título (excepción D1), creador, fecha y estado.
 */
import type { DbCtx } from '../db/client';
import { listClientes } from '../db/clientes';
import { getProyecto } from '../db/proyectos';
import { insertRequerimientos } from '../db/requerimientos';
import { listUsuarios } from '../db/usuarios';
import { audit } from '../db/audit';
import { notificar } from '../notificaciones';
import { BasecampClient } from './client';
import { recorrerTodos } from './recorrer';
import {
  type Huerfano,
  contarHuerfanosPendientes,
  descartarRequerimiento,
  enlazarRequerimientoTodo,
  getHuerfano,
  getRequerimientoPorTodo,
  insertHuerfanos,
  listHuerfanosPendientesTodo,
  listProyectosListasCliente,
  listTodoIdsEnlazados,
  listTodoIdsHuerfanos,
  marcarHuerfanoAdoptado,
  marcarHuerfanoIgnorado,
  marcarHuerfanosAdoptados,
  restaurarRequerimiento,
} from '../db/huerfanos';
import { log } from '../logger';

export { listHuerfanos, type Huerfano } from '../db/huerfanos';

export async function detectarHuerfanos(
  ctx: DbCtx,
  opts: { notificar?: boolean } = {},
): Promise<{ clientes: number; nuevos: number; pendientes: number }> {
  const clientes = (await listClientes(ctx)).filter((c) => c.basecamp_project_id && c.basecamp_importado_at);
  if (clientes.length === 0) return { clientes: 0, nuevos: 0, pendientes: 0 };
  const bc = await BasecampClient.forTenant(ctx.tenantId);
  // Paginado: PostgREST corta en 1000 filas y, con más tareas enlazadas, los to-dos ya conocidos salían como huérfanos.
  const conocidos = new Set(await listTodoIdsEnlazados(ctx));
  // Huérfanos pendientes cuyo to-do ya está enlazado (falsos positivos): se cierran solos.
  {
    const falsos = (await listHuerfanosPendientesTodo(ctx)).filter((h) => conocidos.has(h.basecamp_todo_id)).map((h) => h.id);
    if (falsos.length) await marcarHuerfanosAdoptados(ctx, falsos);
  }
  const yaRegistrados = new Set(await listTodoIdsHuerfanos(ctx));

  let nuevos = 0;
  for (const c of clientes) {
    const pid = c.basecamp_project_id as number;
    try {
      for (const { lista, todos } of (await recorrerTodos(bc, pid, false)).listas) {
        const huerfanos = todos.filter((t) => !conocidos.has(t.id) && !yaRegistrados.has(t.id));
        if (!huerfanos.length) continue;
        await insertHuerfanos(
          ctx,
          huerfanos.map((t) => ({
            tenant_id: ctx.tenantId,
            cliente_id: c.id,
            basecamp_project_id: pid,
            basecamp_todolist_id: t.grupoId ?? lista.id,
            basecamp_todo_id: t.id,
            titulo: t.titulo || `To-do ${t.id}`,
            creador_basecamp_id: t.creator_id,
            creador_nombre: t.creator_nombre,
            due_on: t.due_on,
            completed: t.completed,
            app_url: t.app_url,
          })),
        );
        huerfanos.forEach((t) => yaRegistrados.add(t.id));
        nuevos += huerfanos.length;
      }
    } catch (err) {
      log.error('[huerfanos] cliente', c.nombre, err instanceof Error ? err.message : err);
    }
  }
  const count = await contarHuerfanosPendientes(ctx);
  if (nuevos > 0 && opts.notificar !== false) {
    await notificar(
      ctx,
      {
        tipo: 'huerfanos',
        titulo: `${nuevos} to-do${nuevos === 1 ? '' : 's'} creado${nuevos === 1 ? '' : 's'} fuera de BackIO`,
        cuerpo: `Se detectaron ${nuevos} to-dos nuevos en Basecamp que no pasaron por BackIO. Pendientes de resolver: ${count ?? 0}. Adóptalos o ignóralos desde la pantalla Huérfanos.`,
        ruta: '/huerfanos',
      },
      { roles: ['operaciones'] },
    );
  }
  await audit(ctx, {
    accion: 'detectar_huerfanos',
    entidad: 'tenant',
    entidad_id: ctx.tenantId,
    detalle: { clientes: clientes.length, nuevos, pendientes: count ?? 0 },
  });
  return { clientes: clientes.length, nuevos, pendientes: count ?? 0 };
}

/** Adopta un huérfano: lo convierte en requerimiento del proyecto de su lista (o del indicado). */
export async function adoptarHuerfano(ctx: DbCtx, id: string, proyectoId?: string | null): Promise<{ requerimiento_id: string }> {
  const h: Huerfano = await getHuerfano(ctx, id);
  // Si el to-do ya tiene requerimiento (vivo o eliminado), no se crea otro: se reutiliza.
  const ex = await getRequerimientoPorTodo(ctx, h.basecamp_todo_id);
  if (ex) {
    if (ex.deleted_at) await restaurarRequerimiento(ctx, ex.id);
    await marcarHuerfanoAdoptado(ctx, id, ex.id);
    await audit(ctx, {
      accion: 'adoptar_huerfano',
      entidad: 'requerimiento',
      entidad_id: ex.id,
      detalle: { todo_id: h.basecamp_todo_id, reutilizado: true, restaurado: !!ex.deleted_at },
    });
    return { requerimiento_id: ex.id };
  }
  let pid = proyectoId ?? null;
  if (!pid && h.basecamp_todolist_id) {
    const pg = await listProyectosListasCliente(ctx, h.cliente_id);
    const lista = h.basecamp_todolist_id;
    pid = pg.find((x) => x.basecamp_todolist_id === lista || Object.values(x.basecamp_grupos ?? {}).includes(lista))?.id ?? null;
  }
  const proyecto = pid ? await getProyecto(ctx, pid) : null;
  const usuarios = await listUsuarios(ctx);
  const bloque = proyecto
    ? (Object.entries(proyecto.basecamp_grupos ?? {}).find(([, gid]) => gid === h.basecamp_todolist_id)?.[0] ?? null)
    : null;
  const [req] = await insertRequerimientos(ctx, [
    {
      cliente_id: h.cliente_id,
      proyecto_id: proyecto?.id ?? null,
      bloque_nombre: bloque,
      titulo_interno: h.titulo,
      etiqueta_cliente: null,
      visible_cliente: false,
      tipo_trabajo: 'fee',
      estado_operativo: h.completed ? 'completado' : h.due_on ? 'priorizado' : 'backlog',
      prioridad: 'media',
      peso: 1,
      fecha_entrega: h.due_on,
      owner_agencia: usuarios.filter((u) => u.basecamp_user_id === h.creador_basecamp_id).map((u) => u.id),
      piezas: 0,
    },
  ]);
  if (!req) throw new Error('No se pudo crear el requerimiento');
  // Enlace al to-do: si falla, mejor abortar que dejar un requerimiento suelto que la importación duplicará.
  const eEnlace = await enlazarRequerimientoTodo(ctx, req.id, {
    basecamp_todo_id: h.basecamp_todo_id,
    basecamp_todolist_id: h.basecamp_todolist_id,
    basecamp_url: h.app_url,
  });
  if (eEnlace) {
    await descartarRequerimiento(ctx, req.id);
    throw new Error(`No se pudo enlazar el to-do ${h.basecamp_todo_id}: ${eEnlace.message}`);
  }
  await marcarHuerfanoAdoptado(ctx, id, req.id);
  await audit(ctx, {
    accion: 'adoptar_huerfano',
    entidad: 'requerimiento',
    entidad_id: req.id,
    detalle: { todo_id: h.basecamp_todo_id, proyecto_id: proyecto?.id ?? null },
  });
  return { requerimiento_id: req.id };
}

export async function ignorarHuerfano(ctx: DbCtx, id: string): Promise<void> {
  await marcarHuerfanoIgnorado(ctx, id);
  await audit(ctx, { accion: 'ignorar_huerfano', entidad: 'huerfano', entidad_id: id });
}
