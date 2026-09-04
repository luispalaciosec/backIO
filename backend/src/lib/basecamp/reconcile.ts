/**
 * Polling de reconciliación (cada 30 min). Los webhooks fallan ocasionalmente;
 * sin esto una tarea queda pendiente indefinidamente y aparece como falso atraso.
 * Lee el to-do crudo y lo pasa por extractSafeTodo: nunca guarda texto.
 */
import type { DbCtx } from '../db/client';
import { listBacklog } from '../db/requerimientos';
import { getCliente } from '../db/clientes';
import { BasecampClient } from './client';
import { applyBasecampUpdate, extractSafeTodo } from './sync';

export async function reconcileTenant(ctx: DbCtx): Promise<{ revisados: number; aplicados: number }> {
  const activos = (await listBacklog(ctx, { solo_activos: true })).filter((r) => r.basecamp_todo_id);
  if (activos.length === 0) return { revisados: 0, aplicados: 0 };
  const bc = await BasecampClient.forTenant(ctx.tenantId);
  const proyectosPorCliente = new Map<string, number | null>();
  let aplicados = 0;
  for (const r of activos) {
    if (!proyectosPorCliente.has(r.cliente_id)) {
      proyectosPorCliente.set(r.cliente_id, (await getCliente(ctx, r.cliente_id))?.basecamp_project_id ?? null);
    }
    const bcProject = proyectosPorCliente.get(r.cliente_id);
    if (!bcProject) continue;
    try {
      const raw = await bc.getTodoRaw(bcProject, r.basecamp_todo_id as number);
      const safe = extractSafeTodo(raw);
      if (safe && (await applyBasecampUpdate(ctx, { ...safe, completed: safe.completed ?? false })).aplicado) aplicados += 1;
    } catch (err) {
      console.error('[reconcile] fallo en to-do', r.basecamp_todo_id, err);
    }
  }
  return { revisados: activos.length, aplicados };
}
