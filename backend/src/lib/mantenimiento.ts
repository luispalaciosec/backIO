/**
 * Reparaciones de datos desde Admin → Mantenimiento. Reemplazan a los scripts que se corrían a mano contra producción
 * (docs/17 §8). Cada tarea tiene dos pasos:
 *
 * 1. `revisar`: calcula qué haría y no toca nada.
 * 2. `aplicar`: recibe los ids que la persona confirmó, vuelve a calcular y ejecuta solo los que siguen
 *    apareciendo. Si algo cambió entre la revisión y la confirmación, no se aplica nada que no se haya visto.
 *
 * Cada acción aplicada queda en audit_log con la tarea, el requerimiento y el detalle.
 */
import { audit, type DbCtx } from './db';
import {
  clientesMantenimiento,
  darDeBajaRequerimientos,
  enlazarConTodo,
  huerfanosAdoptados,
  idsBasecampDeUsuarios,
  idsBasecampInactivos,
  requerimientosVivos,
  type ClienteMantenimiento,
  type HuerfanoAdoptado,
  type ReqMantenimiento,
} from './db/mantenimiento';
import { BasecampClient } from './basecamp/client';
import { log } from './logger';

export const TAREAS = {
  adoptados_sin_enlace: {
    titulo: 'Huérfanos adoptados sin enlace',
    descripcion:
      'Requerimientos que nacieron de adoptar un huérfano de Basecamp y perdieron el enlace con su to-do. Se vuelven a enlazar; si otro requerimiento ya tiene ese to-do, este sobra y se da de baja.',
    escribe: 'BackIO',
  },
  duplicados_titulo_fecha: {
    titulo: 'Duplicados por título y fecha',
    descripcion:
      'Tareas abiertas de clientes activos con el mismo título y la misma fecha de entrega. Se conserva la enlazada a Basecamp (o la más antigua) y las demás se dan de baja. Dos tareas enlazadas a to-dos distintos nunca se tocan.',
    escribe: 'BackIO',
  },
  duplicados_sin_enlace: {
    titulo: 'Duplicados sin enlace a Basecamp',
    descripcion:
      'Mismo cliente y mismo título: una tarea enlazada a Basecamp y otra sin enlace (creada a mano, por recurrencia o por el Builder antes de que llegara el to-do real). La que no tiene enlace se da de baja.',
    escribe: 'BackIO',
  },
  asignados_basecamp: {
    titulo: 'Responsables perdidos en Basecamp',
    descripcion:
      'To-dos abiertos que en Basecamp quedaron sin responsables, o asignados a alguien que ya no tiene acceso, cuando en BackIO tienen responsables. Se reenvían los responsables de BackIO. Lee cada to-do en Basecamp, así que la revisión tarda.',
    escribe: 'Basecamp',
  },
} as const;

export type Tarea = keyof typeof TAREAS;

export interface Accion {
  /** Requerimiento afectado: es lo que la persona confirma. */
  id: string;
  tipo: 'dar_de_baja' | 'enlazar' | 'reenviar_responsables';
  cliente: string;
  titulo: string;
  motivo: string;
  /** Datos para ejecutar la acción; no se muestran. */
  datos?: Record<string, unknown>;
}

/** Tope por operación sobre Basecamp (decisión del 03/09/2026: máximo 50 to-dos). */
export const MAX_BASECAMP = 50;

export class TopeExcedido extends Error {}

const cerrada = (r: ReqMantenimiento) => r.estado_operativo === 'completado' || r.estado_operativo === 'cancelado';
const clave = (...partes: (string | null)[]) => partes.map((p) => (p ?? '').trim().toLowerCase()).join('|');

function agrupar<T>(filas: T[], k: (f: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const f of filas) {
    const key = k(f);
    if (key === null) continue;
    m.set(key, [...(m.get(key) ?? []), f]);
  }
  return m;
}

function nombreDe(clientes: ClienteMantenimiento[]) {
  const m = new Map(clientes.map((c) => [c.id, c.nombre]));
  return (id: string) => m.get(id) ?? '—';
}

// ---------------- decisiones (funciones puras, con tests)

export function decidirAdoptadosSinEnlace(
  reqs: ReqMantenimiento[],
  huerfanos: HuerfanoAdoptado[],
  clientes: ClienteMantenimiento[],
): Accion[] {
  const nombre = nombreDe(clientes);
  const porId = new Map(reqs.map((r) => [r.id, r]));
  const porTodo = agrupar(reqs, (r) => (r.basecamp_todo_id ? String(r.basecamp_todo_id) : null));
  const out: Accion[] = [];
  for (const h of huerfanos) {
    const r = h.requerimiento_id ? porId.get(h.requerimiento_id) : undefined;
    if (!r || r.basecamp_todo_id) continue;
    const otro = porTodo.get(String(h.basecamp_todo_id))?.find((x) => x.id !== r.id);
    out.push(
      otro
        ? {
            id: r.id,
            tipo: 'dar_de_baja',
            cliente: nombre(r.cliente_id),
            titulo: r.titulo_interno,
            motivo: 'Otro requerimiento ya está enlazado a su to-do',
            datos: { conservado: otro.id },
          }
        : {
            id: r.id,
            tipo: 'enlazar',
            cliente: nombre(r.cliente_id),
            titulo: r.titulo_interno,
            motivo: 'Se vuelve a enlazar con el to-do que adoptó',
            datos: { basecamp_todo_id: h.basecamp_todo_id, basecamp_todolist_id: h.basecamp_todolist_id, basecamp_url: h.app_url },
          },
    );
  }
  return out;
}

export function decidirDuplicadosTituloFecha(reqs: ReqMantenimiento[], clientes: ClienteMantenimiento[]): Accion[] {
  const nombre = nombreDe(clientes);
  const activos = new Set(clientes.filter((c) => c.activo).map((c) => c.id));
  const abiertas = reqs.filter((r) => !cerrada(r) && activos.has(r.cliente_id));
  const out: Accion[] = [];
  for (const grupo of agrupar(abiertas, (r) => clave(r.cliente_id, r.titulo_interno, r.fecha_entrega)).values()) {
    if (grupo.length < 2) continue;
    const orden = [...grupo].sort(
      (x, y) => Number(!!y.basecamp_todo_id) - Number(!!x.basecamp_todo_id) || x.created_at.localeCompare(y.created_at),
    );
    const conservar = orden[0]!;
    for (const r of orden.slice(1)) {
      // Dos filas enlazadas a to-dos distintos son tareas distintas con el mismo título.
      if (r.basecamp_todo_id && conservar.basecamp_todo_id && r.basecamp_todo_id !== conservar.basecamp_todo_id) continue;
      out.push({
        id: r.id,
        tipo: 'dar_de_baja',
        cliente: nombre(r.cliente_id),
        titulo: r.titulo_interno,
        motivo: conservar.basecamp_todo_id ? 'Duplicada; se conserva la enlazada a Basecamp' : 'Duplicada; se conserva la más antigua',
        datos: { conservado: conservar.id },
      });
    }
  }
  return out;
}

export function decidirDuplicadosSinEnlace(reqs: ReqMantenimiento[], clientes: ClienteMantenimiento[]): Accion[] {
  const nombre = nombreDe(clientes);
  const out: Accion[] = [];
  for (const grupo of agrupar(reqs, (r) => clave(r.cliente_id, r.titulo_interno)).values()) {
    const con = grupo.filter((r) => r.basecamp_todo_id);
    if (!con.length) continue;
    for (const r of grupo.filter((x) => !x.basecamp_todo_id && x.estado_operativo !== 'completado')) {
      out.push({
        id: r.id,
        tipo: 'dar_de_baja',
        cliente: nombre(r.cliente_id),
        titulo: r.titulo_interno,
        motivo: 'Existe la misma tarea enlazada a Basecamp',
        datos: { conservado: con[0]!.id },
      });
    }
  }
  return out;
}

/** Candidatas a reenviar responsables: abiertas, enlazadas, de clientes con Basecamp y con responsables enlazables. */
export function candidatasAsignados(
  reqs: ReqMantenimiento[],
  clientes: ClienteMantenimiento[],
  bcDe: Map<string, number>,
): { req: ReqMantenimiento; proyecto: number; cliente: string; ids: number[] }[] {
  const cli = new Map(clientes.filter((c) => c.activo && c.basecamp_project_id).map((c) => [c.id, c]));
  return reqs.flatMap((r) => {
    const c = cli.get(r.cliente_id);
    if (!c || !r.basecamp_todo_id || cerrada(r)) return [];
    const ids = r.owner_agencia.map((u) => bcDe.get(u)).filter((x): x is number => !!x);
    return ids.length ? [{ req: r, proyecto: c.basecamp_project_id!, cliente: c.nombre, ids }] : [];
  });
}

// ---------------- revisar y aplicar

/** `solo`: al aplicar, se vuelven a leer en Basecamp únicamente los to-dos confirmados. */
async function revisarAsignados(ctx: DbCtx, solo?: Set<string>): Promise<Accion[]> {
  const [reqs, clientes, bcDe, inactivos] = await Promise.all([
    requerimientosVivos(ctx.tenantId),
    clientesMantenimiento(ctx.tenantId),
    idsBasecampDeUsuarios(ctx.tenantId),
    idsBasecampInactivos(ctx.tenantId),
  ]);
  const candidatas = candidatasAsignados(reqs, clientes, bcDe).filter((c) => !solo || solo.has(c.req.id));
  if (!candidatas.length) return [];
  const bc = await BasecampClient.forTenant(ctx.tenantId);
  const out: Accion[] = [];
  // De a 4 en paralelo: rápido sin rozar el límite de Basecamp (el cliente reintenta los 429).
  for (let i = 0; i < candidatas.length; i += 4) {
    await Promise.all(
      candidatas.slice(i, i + 4).map(async (c) => {
        try {
          const vivo = await bc.request<{ assignees?: { id: number }[] }>(
            'GET',
            `/buckets/${c.proyecto}/todos/${c.req.basecamp_todo_id}.json`,
          );
          const asignados = (vivo.assignees ?? []).map((a) => a.id);
          // Quedó vacío (incidente 22/09) o con alguien que se fue y que la salida no alcanzó a cambiar.
          const conInactivo = asignados.some((id) => inactivos.has(id));
          if (asignados.length && !conInactivo) return;
          out.push({
            id: c.req.id,
            tipo: 'reenviar_responsables',
            cliente: c.cliente,
            titulo: c.req.titulo_interno,
            motivo: conInactivo
              ? 'En Basecamp sigue asignada a alguien que ya no tiene acceso'
              : `Sin responsables en Basecamp; BackIO tiene ${c.ids.length}`,
            datos: { proyecto: c.proyecto, todo: c.req.basecamp_todo_id, assignee_ids: c.ids },
          });
        } catch (e) {
          log.warn('[mantenimiento] no se pudo leer el to-do', c.req.basecamp_todo_id, e instanceof Error ? e.message : e);
        }
      }),
    );
  }
  return out;
}

export async function revisar(ctx: DbCtx, tarea: Tarea, solo?: Set<string>): Promise<Accion[]> {
  if (tarea === 'asignados_basecamp') return revisarAsignados(ctx, solo);
  const [reqs, clientes] = await Promise.all([requerimientosVivos(ctx.tenantId), clientesMantenimiento(ctx.tenantId)]);
  if (tarea === 'adoptados_sin_enlace') return decidirAdoptadosSinEnlace(reqs, await huerfanosAdoptados(ctx.tenantId), clientes);
  if (tarea === 'duplicados_titulo_fecha') return decidirDuplicadosTituloFecha(reqs, clientes);
  return decidirDuplicadosSinEnlace(reqs, clientes);
}

export interface Resultado {
  aplicadas: number;
  /** Confirmadas que ya no aparecen en la revisión (alguien las cambió entretanto). */
  omitidas: number;
  errores: { id: string; error: string }[];
}

export async function aplicar(ctx: DbCtx, tarea: Tarea, confirmadas: string[]): Promise<Resultado> {
  if (TAREAS[tarea].escribe === 'Basecamp' && confirmadas.length > MAX_BASECAMP) {
    throw new TopeExcedido(`Como máximo ${MAX_BASECAMP} to-dos de Basecamp por vez`);
  }
  const pedidas = new Set(confirmadas);
  const acciones = (await revisar(ctx, tarea, pedidas)).filter((a) => pedidas.has(a.id));
  const res: Resultado = { aplicadas: 0, omitidas: pedidas.size - acciones.length, errores: [] };

  const bajas = acciones.filter((a) => a.tipo === 'dar_de_baja');
  if (bajas.length) {
    await darDeBajaRequerimientos(
      ctx.tenantId,
      bajas.map((a) => a.id),
    );
    res.aplicadas += bajas.length;
  }
  // Los cambios en Basecamp van a nombre del admin que aplica (su cuenta); la revisión solo lee, con la del tenant.
  const bc = acciones.some((a) => a.tipo === 'reenviar_responsables') ? await BasecampClient.forActor(ctx) : null;
  for (const a of acciones.filter((x) => x.tipo !== 'dar_de_baja')) {
    try {
      if (a.tipo === 'enlazar') {
        await enlazarConTodo(ctx.tenantId, a.id, a.datos as Parameters<typeof enlazarConTodo>[2]);
      } else {
        const d = a.datos as { proyecto: number; todo: number; assignee_ids: number[] };
        // updateTodo reenvía el to-do completo: un PUT parcial borraría los demás campos (docs/04).
        await bc!.updateTodo(d.proyecto, d.todo, { assignee_ids: d.assignee_ids });
      }
      res.aplicadas += 1;
    } catch (e) {
      res.errores.push({ id: a.id, error: e instanceof Error ? e.message : 'error' });
    }
  }

  const fallidas = new Set(res.errores.map((e) => e.id));
  for (const a of acciones.filter((x) => !fallidas.has(x.id))) {
    await audit(ctx, {
      accion: `mantenimiento_${tarea}`,
      entidad: 'requerimiento',
      entidad_id: a.id,
      detalle: { tipo: a.tipo, titulo: a.titulo, cliente: a.cliente, motivo: a.motivo, ...a.datos },
    });
  }
  return res;
}
