/**
 * Actualizar un requerimiento: una sola función con todas las reglas (auditoría 10/10, B9). Antes la ruta REST y el
 * confirm_plan del MCP tenían copias que ya divergían: por MCP no aplicaban la regla de Basecamp sobre completed ni la
 * del daily, no registraban el reproceso al reabrir y el push de la fecha a Basecamp fallaba en silencio.
 * Las rutas quedan como adaptadores: traducen la entrada, llaman aquí y convierten ReglaError en su respuesta.
 */
import type { ActualizarRequerimientoInput, MotivoReprogramacion, Requerimiento } from '@backio/shared';
import { CAMPOS_COLABORADOR } from '@backio/shared';
import type { DbCtx } from '../db/client';
import { audit, getRequerimiento, updateRequerimiento } from '../db';
import { completarUltimaReprogramacion } from '../db/historial';
import { cerrarReproceso, registrarReproceso } from '../cumplimiento';
import { pushDueDate } from '../basecamp/write';

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
    throw new ReglaError('Este requerimiento se completa desde Basecamp (fuente de verdad de completed).', 422);
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
  const { motivo_reprogramacion, observacion_reprogramacion, ...cambios } = patch;
  const r = await updateRequerimiento(ctx, id, cambios);
  if (reprogramado)
    await completarUltimaReprogramacion(ctx, id, {
      motivo: (motivo_reprogramacion as MotivoReprogramacion | null | undefined) ?? null,
      origen: ctx.origen,
      observacion: observacion_reprogramacion ?? null,
    });

  // Rechazo del cliente o reapertura de un completado = reproceso.
  if (patch.estado_aprobacion === 'rechazado' && previo.estado_aprobacion !== 'rechazado') {
    await registrarReproceso(ctx, id, { origen: 'cliente', motivo: null, reabrir_basecamp: true });
  } else if (
    previo.estado_operativo === 'completado' &&
    patch.estado_operativo &&
    patch.estado_operativo !== 'completado' &&
    patch.estado_operativo !== 'cancelado'
  ) {
    await registrarReproceso(ctx, id, { origen: 'interno', motivo: null, reabrir_basecamp: true });
  }
  if (patch.estado_operativo === 'completado' && previo.estado_operativo !== 'completado')
    await cerrarReproceso(ctx, id).catch((e) => console.error('[requerimientos] cerrar reproceso', id, e));

  await audit(ctx, {
    accion: reprogramado ? 'reprogramar' : 'actualizar',
    entidad: 'requerimiento',
    entidad_id: id,
    detalle: { ...(reprogramado ? { de: previo.fecha_entrega, a: patch.fecha_entrega, ...patch } : cambios), ...opts.auditoriaExtra },
  });

  // La fecha baja a Basecamp de inmediato; el resultado se informa y, si falla, queda en la auditoría.
  let basecamp_due_on: ResultadoBasecampDueOn = 'sin_todo';
  if (reprogramado && r.basecamp_todo_id) {
    try {
      await pushDueDate(ctx, r);
      basecamp_due_on = 'ok';
    } catch (err) {
      basecamp_due_on = 'error';
      console.error('[basecamp] due_on no sincronizado', err);
      await audit(ctx, {
        accion: 'basecamp_due_on_error',
        entidad: 'requerimiento',
        entidad_id: id,
        detalle: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }
  return { requerimiento: r, basecamp_due_on };
}
