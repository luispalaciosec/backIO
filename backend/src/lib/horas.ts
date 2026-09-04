/**
 * Horas desde el timesheet de Basecamp (sprint 3). Solo números e ids: fecha, horas, persona, to-do.
 * La descripción de cada entrada nunca entra (se descarta en BasecampClient.timesheetSafe).
 */
import type { DbCtx } from './db/client';
import { throwIf } from './db/client';
import { listClientes } from './db/clientes';
import { listUsuarios } from './db/usuarios';
import { audit } from './db/audit';
import { BasecampClient } from './basecamp/client';

export async function sincronizarHoras(ctx: DbCtx, opts: { dias?: number; clienteId?: string } = {}): Promise<{ clientes: number; entradas: number; guardadas: number; sin_requerimiento: number }> {
  const dias = opts.dias ?? 45;
  const hasta = new Date().toISOString().slice(0, 10);
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10);
  const clientes = (await listClientes(ctx)).filter((c) => c.basecamp_project_id && (!opts.clienteId || c.id === opts.clienteId));
  if (!clientes.length) return { clientes: 0, entradas: 0, guardadas: 0, sin_requerimiento: 0 };
  const bc = await BasecampClient.forTenant(ctx.tenantId);
  const usuarios = await listUsuarios(ctx);
  const porPersona = new Map(usuarios.filter((u) => u.basecamp_user_id).map((u) => [u.basecamp_user_id as number, u.id]));
  const { data: reqs } = await ctx.db.from('requerimientos').select('id, basecamp_todo_id').eq('tenant_id', ctx.tenantId).not('basecamp_todo_id', 'is', null);
  const porTodo = new Map(((reqs ?? []) as { id: string; basecamp_todo_id: number }[]).map((r) => [r.basecamp_todo_id, r.id]));

  let entradas = 0, guardadas = 0, sinReq = 0;
  for (const c of clientes) {
    try {
      const items = await bc.timesheetSafe(c.basecamp_project_id as number, desde, hasta);
      entradas += items.length;
      if (!items.length) continue;
      const filas = items.map((e) => {
        const reqId = e.parent_id ? porTodo.get(e.parent_id) ?? null : null;
        if (!reqId) sinReq += 1;
        return { tenant_id: ctx.tenantId, cliente_id: c.id, requerimiento_id: reqId, usuario_id: e.person_id ? porPersona.get(e.person_id) ?? null : null, basecamp_entry_id: e.id, basecamp_person_id: e.person_id, basecamp_todo_id: e.parent_id, basecamp_project_id: c.basecamp_project_id, fecha: e.fecha, horas: Math.round(e.horas * 100) / 100, sincronizado_at: new Date().toISOString() };
      });
      const { data, error } = await ctx.db.from('horas').upsert(filas, { onConflict: 'tenant_id,basecamp_entry_id' }).select('id');
      throwIf(error);
      guardadas += (data ?? []).length;
    } catch (err) {
      console.error('[horas] cliente', c.nombre, err instanceof Error ? err.message : err);
    }
  }
  await audit(ctx, { accion: 'sincronizar_horas', entidad: 'tenant', entidad_id: ctx.tenantId, detalle: { clientes: clientes.length, entradas, guardadas, sin_requerimiento: sinReq, desde, hasta } });
  return { clientes: clientes.length, entradas, guardadas, sin_requerimiento: sinReq };
}

export interface ResumenHoras {
  por_cliente: Record<string, number>;
  por_usuario: Record<string, number>;
  por_requerimiento: Record<string, number>;
  por_proyecto: Record<string, number>;
  total: number;
}

export async function resumenHoras(ctx: DbCtx, desdeIso: string, filtro: { clienteIds?: string[] } = {}): Promise<ResumenHoras> {
  let q = ctx.db.from('horas').select('cliente_id, usuario_id, requerimiento_id, horas, requerimientos(proyecto_id)').eq('tenant_id', ctx.tenantId).gte('fecha', desdeIso.slice(0, 10));
  if (filtro.clienteIds?.length) q = q.in('cliente_id', filtro.clienteIds);
  const { data, error } = await q;
  throwIf(error);
  const rows = (data ?? []) as unknown as { cliente_id: string; usuario_id: string | null; requerimiento_id: string | null; horas: number; requerimientos: { proyecto_id: string | null } | null }[];
  const pc: Record<string, number> = {}, pu: Record<string, number> = {}, pr: Record<string, number> = {}, pp: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    const h = Number(r.horas) || 0; total += h;
    pc[r.cliente_id] = (pc[r.cliente_id] ?? 0) + h;
    pu[r.usuario_id ?? 'sin_usuario'] = (pu[r.usuario_id ?? 'sin_usuario'] ?? 0) + h;
    if (r.requerimiento_id) pr[r.requerimiento_id] = (pr[r.requerimiento_id] ?? 0) + h;
    const pid = r.requerimientos?.proyecto_id; if (pid) pp[pid] = (pp[pid] ?? 0) + h;
  }
  const r1 = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 10) / 10]));
  return { por_cliente: r1(pc), por_usuario: r1(pu), por_requerimiento: r1(pr), por_proyecto: r1(pp), total: Math.round(total * 10) / 10 };
}
