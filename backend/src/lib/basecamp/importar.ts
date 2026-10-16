/**
 * Importación y sincronización de las listas de to-dos del proyecto Basecamp de un cliente.
 * Desde el 23/09/2026 Basecamp es un origen aceptado: lo que el equipo crea ahí (listas, grupos, to-dos)
 * aparece solo en BackIO cada 30 min (listas → proyectos, grupos → bloques, to-dos → requerimientos) y la
 * ejecutiva completa lo que Basecamp no sabe (prioridad, tipo, piezas, aprobación) desde «Entradas desde Basecamp».
 * Excepción D1 (aprobada por Luis 04/09/2026): entra el TÍTULO del to-do como titulo_interno, nunca visible
 * al cliente (visible_cliente=false, sin etiqueta). No entran descripciones, comentarios ni adjuntos.
 * Idempotente: se enlaza por basecamp_todo_id / basecamp_todolist_id.
 */
import type { DbCtx } from '../db/client';
import { getCliente } from '../db/clientes';
import { listUsuarios } from '../db/usuarios';
import { insertProyecto, updateProyecto } from '../db/proyectos';
import { audit } from '../db/audit';
import {
  actualizarEnlazado,
  enlazadosDeCliente,
  insertarEnlazado,
  marcarClienteImportado,
  marcarHuerfanosAdoptados,
  proyectosDeCliente,
  todosIgnorados,
} from '../db/basecamp_import';
import { generarPortalToken } from '../portal/token';
import { conCandado } from '../candado';
import { BasecampClient } from './client';
import { mapaUsuariosBasecamp, ownersDeBasecamp, recorrerTodos } from './recorrer';
import { cambiosDeEnlazado, clasificarTodo, decidirMovido, fechasProyectoNuevo, filaDesdeTodo } from './decisiones';
import { getRequerimientoPorTodo } from '../db/huerfanos';
import { clientePorProyectoBasecamp } from '../db/clientes';
import { hoyLocal } from '@backio/shared';

export { marcasDeTitulo } from './decisiones';

/** Lo que se mira del to-do vivo cuando ya no aparece en las listas del cliente (nunca texto). */
interface TodoVivo {
  id?: number;
  status?: string;
  bucket?: { id?: number };
}

export interface ResultadoImport {
  listas: number;
  proyectos_creados: number;
  requerimientos_creados: number;
  ya_enlazados: number;
  omitidos_completados_viejos: number;
  responsables_actualizados: number;
  titulos_actualizados: number;
  movidos: number;
  proyectos_renombrados: number;
  eliminados_en_basecamp: number;
  /** To-dos que se movieron a otro proyecto de Basecamp (baja del duplicado o reenlace). */
  movidos_a_otro_proyecto: number;
}

/**
 * Importa y SINCRONIZA la estructura del proyecto Basecamp de un cliente:
 *  - to-dos nuevos → requerimientos (salvo los descartados a mano como huérfanos);
 *  - en los ya enlazados: título (excepción D1), grupo → bloque, lista → proyecto (movimientos), responsables;
 *  - listas renombradas → nombre del proyecto;
 *  - to-dos eliminados/archivados en Basecamp → requerimiento cancelado (queda en historial).
 * Nunca entran descripciones ni comentarios.
 *
 * Una importación por cliente a la vez (B6): el webhook (a los 20 s) y el job de estructura (cada 15 min) se
 * esperan en lugar de correr en paralelo. Si aun así coinciden, el índice único de basecamp_todo_id impide duplicar.
 */
export function importarBasecampCliente(
  ctx: DbCtx,
  clienteId: string,
  opts: { incluirCompletados?: boolean; diasCompletados?: number } = {},
): Promise<ResultadoImport> {
  return conCandado(`importar:${ctx.tenantId}:${clienteId}`, () => importar(ctx, clienteId, opts));
}

async function importar(
  ctx: DbCtx,
  clienteId: string,
  opts: { incluirCompletados?: boolean; diasCompletados?: number },
): Promise<ResultadoImport> {
  const cliente = await getCliente(ctx, clienteId);
  if (!cliente?.basecamp_project_id) throw new Error('Cliente sin proyecto Basecamp');
  const bc = await BasecampClient.forTenant(ctx.tenantId);
  // Con inactivos: así se reconoce a quien se fue y no se confunde con «sin asignar» (ver cambiosDeEnlazado).
  const usuarios = await listUsuarios(ctx, { incluirInactivos: true });
  const porBcUser = mapaUsuariosBasecamp(usuarios);
  const inactivos = new Set(usuarios.filter((u) => !u.activo).map((u) => u.id));
  const { todosetId, listas } = await recorrerTodos(bc, cliente.basecamp_project_id, opts.incluirCompletados ?? true);

  const proyectoPorLista = new Map(
    (await proyectosDeCliente(ctx, clienteId)).filter((p) => p.basecamp_todolist_id).map((p) => [p.basecamp_todolist_id as number, p]),
  );
  const enlazadoPorTodo = new Map((await enlazadosDeCliente(ctx, clienteId)).map((x) => [x.basecamp_todo_id, x]));
  const enlazados = new Set(enlazadoPorTodo.keys());
  const ignorados = await todosIgnorados(ctx);
  const limiteCompletadosMs = Date.now() - (opts.diasCompletados ?? 60) * 86_400_000;
  const vistos = new Set<number>();

  const r: ResultadoImport = {
    listas: listas.length,
    proyectos_creados: 0,
    requerimientos_creados: 0,
    ya_enlazados: 0,
    omitidos_completados_viejos: 0,
    responsables_actualizados: 0,
    titulos_actualizados: 0,
    movidos: 0,
    proyectos_renombrados: 0,
    eliminados_en_basecamp: 0,
    movidos_a_otro_proyecto: 0,
  };

  for (const { lista, grupos, todos } of listas) {
    for (const t of todos) vistos.add(t.id);
    const grupoMap = Object.fromEntries(grupos.map((g) => [g.name, g.id]));
    // Lista renombrada en Basecamp → nombre del proyecto.
    const pExist = proyectoPorLista.get(lista.id);
    if (pExist && pExist.nombre !== undefined && pExist.nombre !== lista.name && lista.name) {
      await updateProyecto(ctx, pExist.id, { nombre: lista.name, basecamp_grupos: grupoMap });
      pExist.nombre = lista.name;
      r.proyectos_renombrados += 1;
    }

    const nuevos = [];
    for (const t of todos) {
      const clase = clasificarTodo(t, { enlazados, ignorados, limiteCompletadosMs });
      if (clase === 'nuevo') nuevos.push(t);
      else if (clase === 'completado_viejo') r.omitidos_completados_viejos += 1;
      else if (clase === 'enlazado') {
        r.ya_enlazados += 1;
        const ex = enlazadoPorTodo.get(t.id)!;
        const c = cambiosDeEnlazado(
          ex,
          t,
          { proyectoId: proyectoPorLista.get(lista.id)?.id ?? null, listaId: lista.id },
          porBcUser,
          inactivos,
        );
        if (c.titulo) r.titulos_actualizados += 1;
        if (c.movido) r.movidos += 1;
        if (c.responsables) r.responsables_actualizados += 1;
        if (Object.keys(c.patch).length) await actualizarEnlazado(ctx, ex.id, c.patch);
      }
    }
    // Sin nada nuevo, la lista solo necesita proyecto si aún no lo tiene (p. ej. le movieron to-dos ya enlazados:
    // con el proyecto creado, la siguiente corrida los mueve).
    if (nuevos.length === 0 && (proyectoPorLista.has(lista.id) || todos.length === 0)) continue;

    let proyecto = proyectoPorLista.get(lista.id);
    if (!proyecto) {
      const { inicio, entrega } = fechasProyectoNuevo(todos, hoyLocal());
      const p = await insertProyecto(ctx, {
        cliente_id: clienteId,
        plantilla_id: null,
        nombre: lista.name,
        brief: { origen: 'importacion_basecamp' },
        fecha_inicio: inicio,
        fecha_entrega: entrega,
        portal_token: generarPortalToken(),
      });
      await updateProyecto(ctx, p.id, {
        basecamp_todolist_id: lista.id,
        basecamp_todoset_id: todosetId,
        basecamp_grupos: grupoMap,
        sync_estado: 'ok',
        estado: todos.every((t) => t.completed) ? 'completado' : 'en_ejecucion',
      });
      proyecto = { id: p.id, basecamp_todolist_id: lista.id, basecamp_grupos: grupoMap };
      proyectoPorLista.set(lista.id, proyecto);
      r.proyectos_creados += 1;
    }

    const creados: number[] = [];
    for (const t of nuevos) {
      const req = await insertarEnlazado(
        ctx,
        filaDesdeTodo(t, { clienteId, proyectoId: proyecto.id, listaId: lista.id, porBcUser, inactivos }),
      );
      enlazados.add(t.id);
      if (!req) {
        r.ya_enlazados += 1; // Otro proceso lo enlazó entre la lectura y la inserción.
        continue;
      }
      creados.push(t.id);
      // Una entrada por to-do: alimenta la bandeja «Entradas desde Basecamp» y el Día a día.
      if (!t.completed)
        await audit(ctx, {
          accion: 'basecamp_entrada',
          entidad: 'requerimiento',
          entidad_id: req.id,
          detalle: {
            todo_id: t.id,
            titulo: t.titulo,
            cliente_id: clienteId,
            proyecto_id: proyecto.id,
            lista: lista.name,
            bloque: t.bloque,
            creador: t.creator_nombre,
            due_on: t.due_on,
            sin_responsable: !ownersDeBasecamp(t.assignee_ids, porBcUser).some((u) => !inactivos.has(u)),
          },
        });
    }
    // Si alguno estaba en la lista de huérfanos, queda resuelto como adoptado.
    await marcarHuerfanosAdoptados(ctx, creados);
    r.requerimientos_creados += creados.length;
  }

  // To-dos enlazados y abiertos que ya no aparecen en ninguna lista: se verifica uno a uno y, si Basecamp
  // los tiene en la papelera o archivados (o ya no existen), el requerimiento se cancela.
  for (const ex of enlazadoPorTodo.values()) {
    if (vistos.has(ex.basecamp_todo_id) || ex.estado_operativo === 'completado' || ex.estado_operativo === 'cancelado') continue;
    let eliminado = false;
    let raw: TodoVivo | null = null;
    try {
      raw = (await bc.getTodoRaw(cliente.basecamp_project_id, ex.basecamp_todo_id)) as TodoVivo | null;
      eliminado = !raw || raw.status === 'trashed' || raw.status === 'archived';
    } catch (err) {
      eliminado = /\b404\b/.test(err instanceof Error ? err.message : '');
    }
    // Movido a otro proyecto de Basecamp: el id viejo redirige al to-do nuevo (ver decidirMovido).
    if (!eliminado && raw?.id) {
      const otro = raw.id !== ex.basecamp_todo_id ? await getRequerimientoPorTodo(ctx, raw.id) : null;
      const d = decidirMovido(
        ex,
        { id: raw.id, bucketId: raw.bucket?.id ?? null },
        cliente.basecamp_project_id,
        otro && otro.id !== ex.id && !otro.deleted_at ? otro : null,
      );
      if (d.tipo === 'baja') {
        await actualizarEnlazado(ctx, ex.id, { deleted_at: new Date().toISOString(), daily_fecha: null });
        await audit(ctx, {
          accion: 'basecamp_movido',
          entidad: 'requerimiento',
          entidad_id: ex.id,
          detalle: { de: ex.basecamp_todo_id, a: raw.id, conservado: d.conservado, titulo: ex.titulo_interno, resultado: 'baja_duplicado' },
        });
        r.movidos_a_otro_proyecto += 1;
      } else if (d.tipo === 'reenlazar') {
        const destino = await clientePorProyectoBasecamp(d.bucketId);
        if (destino && destino.tenant_id === ctx.tenantId) {
          // Cambia de cliente: nace oculta en el portal del nuevo (regla 2: solo se restringe). El proyecto y el bloque los
          // corrige la próxima importación del cliente destino, que ya la ve como enlazada.
          await actualizarEnlazado(ctx, ex.id, {
            basecamp_todo_id: d.todoId,
            cliente_id: destino.id,
            proyecto_id: null,
            visible_cliente: false,
          });
          await audit(ctx, {
            accion: 'basecamp_movido',
            entidad: 'requerimiento',
            entidad_id: ex.id,
            detalle: { de: ex.basecamp_todo_id, a: d.todoId, cliente_destino: destino.nombre, titulo: ex.titulo_interno, resultado: 'reenlazado' },
          });
          r.movidos_a_otro_proyecto += 1;
        }
      }
      if (d.tipo !== 'ninguno') continue;
    }
    if (!eliminado) continue;
    await actualizarEnlazado(ctx, ex.id, { estado_operativo: 'cancelado', daily_fecha: null });
    await audit(ctx, {
      accion: 'basecamp_eliminado',
      entidad: 'requerimiento',
      entidad_id: ex.id,
      detalle: { todo_id: ex.basecamp_todo_id, titulo: ex.titulo_interno },
    });
    r.eliminados_en_basecamp += 1;
  }
  await marcarClienteImportado(ctx, clienteId);
  await audit(ctx, { accion: 'basecamp_importar', entidad: 'cliente', entidad_id: clienteId, detalle: r });
  return r;
}
