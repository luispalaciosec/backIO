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
  // Paginado: PostgREST corta en 1000 filas; sin esto las horas de los to-dos restantes quedaban sin tarea.
  const porTodo = new Map<number, string>();
  for (let from = 0; ; from += 1000) {
    const { data: reqs } = await ctx.db.from('requerimientos').select('id, basecamp_todo_id').eq('tenant_id', ctx.tenantId).not('basecamp_todo_id', 'is', null).order('id').range(from, from + 999);
    const filas = (reqs ?? []) as { id: string; basecamp_todo_id: number }[];
    for (const r of filas) porTodo.set(r.basecamp_todo_id, r.id);
    if (filas.length < 1000) break;
  }

  // Una sola llamada: el reporte ignora bucket_id (devuelve la cuenta entera), así que se atribuye cada
  // entrada al cliente por el proyecto que trae la propia entrada. Antes se llamaba por cliente y todas
  // las horas quedaban bajo el último cliente del bucle.
  const porProyecto = new Map(clientes.map((c) => [c.basecamp_project_id as number, c]));
  let entradas = 0, guardadas = 0, sinReq = 0, sinCliente = 0;
  try {
    const items = await bc.timesheetSafe(desde, hasta);
    const filas = [] as Record<string, unknown>[];
    for (const e of items) {
      const c = e.bucket_id ? porProyecto.get(e.bucket_id) : undefined;
      if (!c) { sinCliente += 1; continue; }
      entradas += 1;
      const reqId = e.parent_id ? porTodo.get(e.parent_id) ?? null : null;
      if (!reqId) sinReq += 1;
      filas.push({ tenant_id: ctx.tenantId, cliente_id: c.id, requerimiento_id: reqId, usuario_id: e.person_id ? porPersona.get(e.person_id) ?? null : null, basecamp_entry_id: e.id, basecamp_person_id: e.person_id, basecamp_todo_id: e.parent_id, basecamp_project_id: c.basecamp_project_id, fecha: e.fecha, horas: Math.round(e.horas * 100) / 100, sincronizado_at: new Date().toISOString() });
    }
    for (let i = 0; i < filas.length; i += 500) {
      const { data, error } = await ctx.db.from('horas').upsert(filas.slice(i, i + 500), { onConflict: 'tenant_id,basecamp_entry_id' }).select('id');
      throwIf(error);
      guardadas += (data ?? []).length;
    }
  } catch (err) {
    console.error('[horas]', err instanceof Error ? err.message : err);
    throw err;
  }
  await audit(ctx, { accion: 'sincronizar_horas', entidad: 'tenant', entidad_id: ctx.tenantId, detalle: { clientes: clientes.length, entradas, guardadas, sin_requerimiento: sinReq, sin_cliente: sinCliente, desde, hasta } });
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
