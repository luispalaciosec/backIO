/**
 * «¿Ya se entregó?» (docs/22, decisión de Luis 30/10/2026). Una tarea que pasó su fecha y no se movió suele estar
 * entregada y sin cerrar en Basecamp: BackIO la contaba como atrasada. Se le pregunta a su responsable y responde en
 * un clic:
 *  - «Sí, el día X»: se guarda entregado_el (manda sobre el cierre para «a tiempo») y se completa el to-do en Basecamp
 *    con la cuenta de quien responde. BackIO no la marca completada: lo hace la sincronización (regla 3).
 *  - «Espera al cliente»: pasa a «pendiente del cliente» (deja de contar para la salud) y se avisa a la ejecutiva.
 *  - «Todavía no»: la pantalla abre la reprogramación de siempre, con su motivo.
 */
import type { Requerimiento, RequerimientoMetricas } from '@backio/shared';
import { diaLocal, hoyLocal } from '@backio/shared';
import { serviceClient, type DbCtx } from './db/client';
import { getRequerimiento, listBacklog, updateRequerimiento } from './db/requerimientos';
import { getCliente, idsClientesDePrueba } from './db/clientes';
import { audit } from './db/audit';
import { BasecampClient } from './basecamp/client';
import { completarTodo } from './basecamp/write';
import { actualizarRequerimiento, ReglaError } from './requerimientos/actualizar';
import { notificar } from './notificaciones';
import { log } from './logger';

/** Días sin movimiento desde los que se pregunta (una tarea recién vencida todavía puede estar en curso). */
export const DIAS_QUIETA_PARA_PREGUNTAR = 2;

/** ¿Hay que preguntarle a su responsable si ya se entregó? */
export function debePreguntarse(
  r: Pick<RequerimientoMetricas, 'dias_atraso' | 'dias_sin_movimiento' | 'estado_aprobacion' | 'entregado_el'>,
): boolean {
  return (
    r.dias_atraso > 0 &&
    r.dias_sin_movimiento >= DIAS_QUIETA_PARA_PREGUNTAR &&
    r.estado_aprobacion !== 'pendiente_cliente' &&
    !r.entregado_el
  );
}

/** Tareas de la persona por las que se le pregunta «¿ya se entregó?», la más atrasada primero. */
export async function pendientesDeEntrega(ctx: DbCtx, usuarioId: string): Promise<RequerimientoMetricas[]> {
  const [activas, prueba] = await Promise.all([listBacklog(ctx, { owner: usuarioId, solo_activos: true }), idsClientesDePrueba(ctx)]);
  return activas.filter((r) => !prueba.has(r.cliente_id) && debePreguntarse(r)).sort((a, b) => b.dias_atraso - a.dias_atraso);
}

export type RespuestaEntrega = { respuesta: 'entregado'; fecha: string } | { respuesta: 'espera_cliente' };

export interface ResultadoEntrega {
  respuesta: RespuestaEntrega['respuesta'];
  /** Para «entregado»: si se completó el to-do en Basecamp, si no tenía to-do (se completó en BackIO) o si falló. */
  basecamp?: 'completado' | 'sin_todo' | 'error';
  aviso?: string;
}

/** Valida y aplica la respuesta. `esGestion`: quien no es responsable solo puede responder si es de gestión. */
export async function responderEntrega(
  ctx: DbCtx,
  requerimientoId: string,
  r: RespuestaEntrega,
  opts: { esGestion: boolean },
): Promise<ResultadoEntrega> {
  const req = await getRequerimiento(ctx, requerimientoId);
  if (!req) throw new ReglaError('Tarea no encontrada', 404);
  if (!opts.esGestion && !(ctx.usuarioId && req.owner_agencia.includes(ctx.usuarioId)))
    throw new ReglaError('Solo responde quien tiene la tarea', 403);
  if (req.estado_operativo === 'completado' || req.estado_operativo === 'cancelado') throw new ReglaError('La tarea ya está cerrada', 422);
  // El backend escribe con service role: el trigger no deja a un colaborador fijar fechas pasadas ni la aprobación.
  const svc: DbCtx = { ...ctx, db: serviceClient() };

  if (r.respuesta === 'espera_cliente') {
    await updateRequerimiento(svc, req.id, { estado_aprobacion: 'pendiente_cliente' });
    await audit(ctx, { accion: 'entrega_espera_cliente', entidad: 'requerimiento', entidad_id: req.id });
    await avisarEjecutiva(ctx, req).catch((e: Error) => log.error('[entregas] aviso a la ejecutiva', e.message));
    return { respuesta: 'espera_cliente' };
  }

  const hoy = hoyLocal();
  const pedido = req.fecha_pedido ?? diaLocal(req.created_at);
  if (r.fecha > hoy) throw new ReglaError('La fecha de entrega no puede ser futura', 422);
  if (pedido && r.fecha < pedido) throw new ReglaError('La fecha de entrega no puede ser anterior al pedido', 422);

  // Con to-do: la cuenta de Basecamp de quien responde se pide antes de guardar (sin ella, 428 y no se guarda nada).
  const bc = req.basecamp_todo_id ? await BasecampClient.forActor(ctx) : null;
  await updateRequerimiento(svc, req.id, {
    entregado_el: r.fecha,
    entregado_por: ctx.usuarioId,
    entregado_registrado_at: new Date().toISOString(),
  });
  await audit(ctx, { accion: 'entrega_declarada', entidad: 'requerimiento', entidad_id: req.id, detalle: { entregado_el: r.fecha } });

  if (!bc) {
    // Sin to-do no hay Basecamp que mande: se completa en BackIO con las reglas de siempre.
    await actualizarRequerimiento(ctx, req.id, { estado_operativo: 'completado' }, { colaborador: !opts.esGestion, exigirMotivo: false });
    return { respuesta: 'entregado', basecamp: 'sin_todo' };
  }
  try {
    await completarTodo(ctx, req, bc);
    return { respuesta: 'entregado', basecamp: 'completado' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await audit(ctx, { accion: 'basecamp_completar_error', entidad: 'requerimiento', entidad_id: req.id, detalle: { error: msg } });
    return {
      respuesta: 'entregado',
      basecamp: 'error',
      aviso: 'Se guardó la fecha de entrega, pero no se pudo cerrar el to-do en Basecamp. Ciérralo allá.',
    };
  }
}

/** La ejecutiva de la cuenta (o, si no tiene, operaciones) se entera de que la tarea espera al cliente. */
async function avisarEjecutiva(ctx: DbCtx, req: Requerimiento): Promise<void> {
  const cliente = await getCliente({ ...ctx, db: serviceClient() }, req.cliente_id);
  await notificar(
    ctx,
    {
      tipo: 'espera_cliente',
      titulo: `${cliente?.nombre ?? 'Un cliente'}: una tarea espera su respuesta`,
      cuerpo: `«${req.titulo_interno}» pasó su fecha y, según su responsable, espera al cliente. Pide el feedback.`,
      ruta: `/clientes/${req.cliente_id}`,
      entidad_tipo: 'requerimiento',
      entidad_id: req.id,
    },
    cliente?.ejecutiva_id ? { usuarioIds: [cliente.ejecutiva_id] } : { roles: ['operaciones'] },
  );
}
