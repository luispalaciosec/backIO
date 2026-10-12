/**
 * Horas desde el timesheet de Basecamp (sprint 3). Solo números e ids: fecha, horas, persona, to-do.
 * La descripción de cada entrada nunca entra (se descarta en BasecampClient.timesheetSafe).
 */
import type { DbCtx } from './db/client';
import type { FilaInsert } from './db/client';
import { listHorasDesde, listRequerimientosConTodo, upsertHoras } from './db/horas';
import { listClientes } from './db/clientes';
import { listUsuarios } from './db/usuarios';
import { audit } from './db/audit';
import { BasecampClient } from './basecamp/client';
import { hoyLocal, sumarDias } from '@backio/shared';
import { log } from './logger';

export async function sincronizarHoras(
  ctx: DbCtx,
  opts: { dias?: number; clienteId?: string } = {},
): Promise<{ clientes: number; entradas: number; guardadas: number; sin_requerimiento: number }> {
  const dias = opts.dias ?? 45;
  const hasta = hoyLocal();
  const desde = sumarDias(hasta, -dias);
  const clientes = (await listClientes(ctx)).filter((c) => c.basecamp_project_id && (!opts.clienteId || c.id === opts.clienteId));
  if (!clientes.length) return { clientes: 0, entradas: 0, guardadas: 0, sin_requerimiento: 0 };
  const bc = await BasecampClient.forTenant(ctx.tenantId);
  // Con inactivos: cada corrida reescribe 45 días, y sin ellos las horas de quien se fue quedaban sin persona.
  const usuarios = await listUsuarios(ctx, { incluirInactivos: true });
  const porPersona = new Map(usuarios.filter((u) => u.basecamp_user_id).map((u) => [u.basecamp_user_id as number, u.id]));
  // Paginado: PostgREST corta en 1000 filas; sin esto las horas de los to-dos restantes quedaban sin tarea.
  // Una página fallida lanza: antes cortaba el bucle en silencio y las horas quedaban sin tarea.
  const porTodo = new Map((await listRequerimientosConTodo(ctx)).map((r) => [r.basecamp_todo_id, r.id]));

  // Una sola llamada: el reporte ignora bucket_id (devuelve la cuenta entera), así que se atribuye cada
  // entrada al cliente por el proyecto que trae la propia entrada. Antes se llamaba por cliente y todas
  // las horas quedaban bajo el último cliente del bucle.
  const porProyecto = new Map(clientes.map((c) => [c.basecamp_project_id as number, c]));
  let entradas = 0,
    guardadas = 0,
    sinReq = 0,
    sinCliente = 0;
  try {
    const items = await bc.timesheetSafe(desde, hasta);
    const filas: FilaInsert<'horas'>[] = [];
    for (const e of items) {
      const c = e.bucket_id ? porProyecto.get(e.bucket_id) : undefined;
      if (!c) {
        sinCliente += 1;
        continue;
      }
      entradas += 1;
      const reqId = e.parent_id ? (porTodo.get(e.parent_id) ?? null) : null;
      if (!reqId) sinReq += 1;
      filas.push({
        tenant_id: ctx.tenantId,
        cliente_id: c.id,
        requerimiento_id: reqId,
        usuario_id: e.person_id ? (porPersona.get(e.person_id) ?? null) : null,
        basecamp_entry_id: e.id,
        basecamp_person_id: e.person_id,
        basecamp_todo_id: e.parent_id,
        basecamp_project_id: c.basecamp_project_id,
        fecha: e.fecha,
        horas: Math.round(e.horas * 100) / 100,
        sincronizado_at: new Date().toISOString(),
      });
    }
    for (let i = 0; i < filas.length; i += 500) {
      guardadas += await upsertHoras(ctx, filas.slice(i, i + 500));
    }
  } catch (err) {
    log.error('[horas]', err instanceof Error ? err.message : err);
    throw err;
  }
  await audit(ctx, {
    accion: 'sincronizar_horas',
    entidad: 'tenant',
    entidad_id: ctx.tenantId,
    detalle: { clientes: clientes.length, entradas, guardadas, sin_requerimiento: sinReq, sin_cliente: sinCliente, desde, hasta },
  });
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
  const rows = await listHorasDesde(ctx, desdeIso.slice(0, 10), filtro.clienteIds);
  const pc: Record<string, number> = {},
    pu: Record<string, number> = {},
    pr: Record<string, number> = {},
    pp: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    const h = Number(r.horas) || 0;
    total += h;
    pc[r.cliente_id] = (pc[r.cliente_id] ?? 0) + h;
    pu[r.usuario_id ?? 'sin_usuario'] = (pu[r.usuario_id ?? 'sin_usuario'] ?? 0) + h;
    if (r.requerimiento_id) pr[r.requerimiento_id] = (pr[r.requerimiento_id] ?? 0) + h;
    const pid = r.requerimientos?.proyecto_id;
    if (pid) pp[pid] = (pp[pid] ?? 0) + h;
  }
  const r1 = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 10) / 10]));
  return { por_cliente: r1(pc), por_usuario: r1(pu), por_requerimiento: r1(pr), por_proyecto: r1(pp), total: Math.round(total * 10) / 10 };
}
