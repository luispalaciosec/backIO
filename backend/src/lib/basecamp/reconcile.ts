/**
 * Polling de reconciliación (cada 30 min). Los webhooks fallan ocasionalmente;
 * sin esto una tarea queda pendiente indefinidamente y aparece como falso atraso.
 * Lee el to-do crudo y lo pasa por extractSafeTodo: nunca guarda texto.
 */
import type { DbCtx } from '../db/client';
import { listBacklog } from '../db/requerimientos';
import { getCliente } from '../db/clientes';
import { pushDueDate } from './write';
import { BasecampClient } from './client';
import { applyBasecampUpdate, extractSafeTodo } from './sync';
import { audit } from '../db/audit';
import { ultimoQueReprogramo } from '../db/historial';
import { log } from '../logger';

/** Tope de fechas reenviadas a Basecamp por corrida: un desfase masivo no se propaga entero de una vez (M14). */
const MAX_FECHAS_POR_CORRIDA = 25;

export async function reconcileTenant(ctx: DbCtx): Promise<{ revisados: number; aplicados: number }> {
  const activos = (await listBacklog(ctx, { solo_activos: true })).filter((r) => r.basecamp_todo_id);
  if (activos.length === 0) return { revisados: 0, aplicados: 0 };
  // Lectura con la cuenta de la organización; el reenvío de fechas, con la de quien la cambió (abajo).
  const bc = await BasecampClient.forTenant(ctx.tenantId);
  const clientes = new Map<string, BasecampClient | null>();
  const proyectosPorCliente = new Map<string, number | null>();
  let aplicados = 0,
    fechas = 0;
  for (const r of activos) {
    if (!proyectosPorCliente.has(r.cliente_id)) {
      proyectosPorCliente.set(r.cliente_id, (await getCliente(ctx, r.cliente_id))?.basecamp_project_id ?? null);
    }
    const bcProject = proyectosPorCliente.get(r.cliente_id);
    if (!bcProject) continue;
    try {
      const raw = await bc.getTodoRaw(bcProject, r.basecamp_todo_id as number);
      const safe = extractSafeTodo(raw);
      const res = safe ? await applyBasecampUpdate(ctx, { ...safe, completed: safe.completed ?? false }) : null;
      if (res?.aplicado) aplicados += 1;
      // La fecha: si alguien la cambió en Basecamp después que en BackIO, applyBasecampUpdate ya la aceptó. Si BackIO la
      // cambió después y no llegó a Basecamp, se reenvía a nombre de quien la cambió, solo si conectó su Basecamp:
      // nunca con la cuenta de otro (19/10/2026). Si no, queda pendiente hasta que lo conecte.
      if (safe && !res?.fecha_aceptada && r.fecha_entrega && safe.due_on !== r.fecha_entrega && fechas < MAX_FECHAS_POR_CORRIDA) {
        try {
          const quien = await ultimoQueReprogramo(ctx, r.id);
          const k = quien ?? '';
          if (!clientes.has(k)) clientes.set(k, await BasecampClient.forResponsable(ctx.tenantId, quien));
          const suyo = clientes.get(k);
          if (!suyo) {
            log.warn('[reconcile] fecha sin reenviar: quien la cambió no conectó su Basecamp', r.basecamp_todo_id);
            continue;
          }
          fechas += 1;
          await pushDueDate(ctx, r, suyo);
          await audit(ctx, {
            accion: 'basecamp_fecha_reenviada',
            entidad: 'requerimiento',
            entidad_id: r.id,
            detalle: { todo_id: r.basecamp_todo_id, basecamp: safe.due_on, backio: r.fecha_entrega },
          });
        } catch (e) {
          log.error('[reconcile] due_on', r.basecamp_todo_id, e instanceof Error ? e.message : e);
        }
      }
    } catch (err) {
      log.error('[reconcile] fallo en to-do', r.basecamp_todo_id, err);
    }
  }
  return { revisados: activos.length, aplicados };
}
