/**
 * Actualizar un requerimiento: una sola función con todas las reglas (auditoría 10/10, B9). Antes la ruta REST y el
 * confirm_plan del MCP tenían copias que ya divergían: por MCP no aplicaban la regla de Basecamp sobre completed ni la
 * del daily, no registraban el reproceso al reabrir y el push de la fecha a Basecamp fallaba en silencio.
 * Las rutas quedan como adaptadores: traducen la entrada, llaman aquí y convierten ReglaError en su respuesta.
 */
import { BasecampClient } from '../basecamp/client';
import type { ActualizarRequerimientoInput, MotivoReprogramacion, Requerimiento } from '@backio/shared';
import { CAMPOS_COLABORADOR } from '@backio/shared';
import type { DbCtx } from '../db/client';
import { audit, getRequerimiento, updateRequerimiento } from '../db';
import { completarUltimaReprogramacion } from '../db/historial';
import { marcarDueOnVisto } from '../db/requerimientos';
import { cerrarReproceso, registrarReproceso } from '../cumplimiento';
import { archivarTodo, pushDueDate, pushResponsables } from '../basecamp/write';
import { log } from '../logger';

export class ReglaError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404 | 422,
  ) {
    super(message);
  }
}

export interface OpcionesActualizar {
  /** Quien actualiza es colaborador: solo sus tareas y solo CAMPOS_COLABORADOR. */
  colaborador: boolean;
  /** Exigir motivo al cambiar la fecha de entrega (la UI y el MCP lo exigen; la API REST puede omitirlo). */
  exigirMotivo: boolean;
  /** Datos extra para la auditoría (p. ej. plan_id del MCP). */
  auditoriaExtra?: Record<string, unknown>;
}

export type ResultadoBasecampDueOn = 'ok' | 'error' | 'sin_todo';

const esReprogramacion = (previo: Requerimiento, patch: ActualizarRequerimientoInput) =>
  patch.fecha_entrega !== undefined && patch.fecha_entrega !== previo.fecha_entrega && previo.fecha_entrega !== null;
/**
 * La fecha cambió y hay que llevarla a Basecamp: también cuando la tarea no tenía fecha (llegó de Basecamp sin
 * `due_on` y se la ponen en BackIO). Eso no es reprogramar (no cuenta en métricas), pero antes por eso tampoco bajaba
 * a Basecamp y quedaba sin fecha allá (dos tareas de AB-Inbev, auditoría del 28/10/2026).
 */
const fechaParaBasecamp = (previo: Requerimiento, patch: ActualizarRequerimientoInput) =>
  patch.fecha_entrega !== undefined && patch.fecha_entrega !== null && patch.fecha_entrega !== previo.fecha_entrega;

/** Reglas que no dependen de escribir: sirven también para el preview del MCP. Lanza ReglaError. */
export function validarActualizacion(
  ctx: DbCtx,
  previo: Requerimiento,
  patch: ActualizarRequerimientoInput,
  opts: Pick<OpcionesActualizar, 'colaborador' | 'exigirMotivo'>,
): void {
  if (opts.colaborador) {
    if (!ctx.usuarioId || !previo.owner_agencia.includes(ctx.usuarioId))
      throw new ReglaError('Solo puedes actualizar las tareas asignadas a ti', 403);
    const noPermitidos = Object.keys(patch).filter((k) => !(CAMPOS_COLABORADOR as readonly string[]).includes(k));
    if (noPermitidos.length)
      throw new ReglaError(
        `Como colaborador solo puedes cambiar estado, fecha de entrega y entregables (no: ${noPermitidos.join(', ')})`,
        403,
      );
  }
  // Regla 3: Basecamp manda sobre completed. No se completa desde BackIO si el to-do existe en Basecamp.
  if (patch.estado_operativo === 'completado' && previo.basecamp_todo_id)
    throw new ReglaError('Esta tarea se marca como completada en Basecamp.', 422);
  // Regla del daily (22/09): ninguna tarea entra al daily sin al menos un responsable.
  if (patch.daily_fecha) {
    const owners = patch.owner_agencia ?? previo.owner_agencia ?? [];
    if (owners.length === 0)
      throw new ReglaError(`«${previo.titulo_interno}» no tiene responsable. Asigna a alguien antes de ponerla en el daily.`, 422);
  }
  if (esReprogramacion(previo, patch) && opts.exigirMotivo && !patch.motivo_reprogramacion)
    throw new ReglaError('Para cambiar la fecha de entrega indica el motivo de la reprogramación.', 422);
}

export async function actualizarRequerimiento(
  ctx: DbCtx,
  id: string,
  patch: ActualizarRequerimientoInput,
  opts: OpcionesActualizar,
): Promise<{ requerimiento: Requerimiento; basecamp_due_on: ResultadoBasecampDueOn }> {
  const previo = await getRequerimiento(ctx, id);
  if (!previo) throw new ReglaError('No encontrado', 404);
  validarActualizacion(ctx, previo, patch, opts);

  const reprogramado = esReprogramacion(previo, patch);
  const rechazo = patch.estado_aprobacion === 'rechazado' && previo.estado_aprobacion !== 'rechazado';
  const reapertura =
    previo.estado_operativo === 'completado' &&
    !!patch.estado_operativo &&
    patch.estado_operativo !== 'completado' &&
    patch.estado_operativo !== 'cancelado';
  // Lo que baja a Basecamp va con la cuenta de quien hace el cambio. Se pide ANTES de guardar nada: si la persona no
  // conectó su Basecamp, el cambio no se aplica a medias (migración 33).
  const fechaNueva = fechaParaBasecamp(previo, patch);
  // Cancelar archiva el to-do en Basecamp; sacar una tarea de «cancelado» lo vuelve a dejar activo (28/10/2026).
  const cancelacion = patch.estado_operativo === 'cancelado' && previo.estado_operativo !== 'cancelado';
  // Responsables cambiados en BackIO → asignados en Basecamp (28/10/2026; antes la sincronización los deshacía).
  const responsables =
    patch.owner_agencia !== undefined &&
    (patch.owner_agencia.length !== previo.owner_agencia.length || patch.owner_agencia.some((u) => !previo.owner_agencia.includes(u)));
  const reactivacion = previo.estado_operativo === 'cancelado' && !!patch.estado_operativo && patch.estado_operativo !== 'cancelado';
  const bc =
    previo.basecamp_todo_id && (fechaNueva || rechazo || reapertura || cancelacion || reactivacion || responsables)
      ? await BasecampClient.forActor(ctx)
      : undefined;
  const { motivo_reprogramacion, observacion_reprogramacion, ...cambios } = patch;
  const r = await updateRequerimiento(ctx, id, cambios);
  if (reprogramado)
    await completarUltimaReprogramacion(ctx, id, {
      motivo: (motivo_reprogramacion as MotivoReprogramacion | null | undefined) ?? null,
      origen: ctx.origen,
      observacion: observacion_reprogramacion ?? null,
    });

  // Rechazo del cliente o reapertura de un completado = reproceso.
  if (rechazo) {
    await registrarReproceso(ctx, id, { origen: 'cliente', motivo: null, reabrir_basecamp: true, bc });
  } else if (reapertura) {
    await registrarReproceso(ctx, id, { origen: 'interno', motivo: null, reabrir_basecamp: true, estabaCompletada: true, bc });
  }
  if (patch.estado_operativo === 'completado' && previo.estado_operativo !== 'completado')
    await cerrarReproceso(ctx, id).catch((e) => log.error('[requerimientos] cerrar reproceso', id, e));

  await audit(ctx, {
    accion: reprogramado ? 'reprogramar' : 'actualizar',
    entidad: 'requerimiento',
    entidad_id: id,
    detalle: { ...(reprogramado ? { de: previo.fecha_entrega, a: patch.fecha_entrega, ...patch } : cambios), ...opts.auditoriaExtra },
  });

  // La fecha baja a Basecamp de inmediato; el resultado se informa y, si falla, queda en la auditoría.
  let basecamp_due_on: ResultadoBasecampDueOn = 'sin_todo';
  if (fechaNueva && r.basecamp_todo_id) {
    try {
      await pushDueDate(ctx, r, bc);
      basecamp_due_on = 'ok';
      await marcarDueOnVisto(ctx.tenantId, r.id, r.fecha_entrega);
    } catch (err) {
      basecamp_due_on = 'error';
      log.error('[basecamp] due_on no sincronizado', err);
      await audit(ctx, {
        accion: 'basecamp_due_on_error',
        entidad: 'requerimiento',
        entidad_id: id,
        detalle: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }
  if (responsables && r.basecamp_todo_id) {
    try {
      await pushResponsables(ctx, r, bc);
    } catch (err) {
      log.error('[basecamp] no se pudieron actualizar los responsables del to-do', err);
      await audit(ctx, {
        accion: 'basecamp_responsables_error',
        entidad: 'requerimiento',
        entidad_id: id,
        detalle: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }
  if ((cancelacion || reactivacion) && r.basecamp_todo_id) {
    try {
      await archivarTodo(ctx, r, cancelacion, bc);
    } catch (err) {
      log.error('[basecamp] no se pudo archivar o restaurar el to-do', err);
      await audit(ctx, {
        accion: 'basecamp_archivar_error',
        entidad: 'requerimiento',
        entidad_id: id,
        detalle: { error: err instanceof Error ? err.message : String(err), archivar: cancelacion },
      });
    }
  }
  return { requerimiento: r, basecamp_due_on };
}
