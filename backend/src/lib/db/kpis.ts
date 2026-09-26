/**
 * Acceso a datos de KPIs (docs/19-kpis.md). Las tablas de KPIs se escriben con service role:
 * el permiso fino (catálogo solo admin; mediciones admin/gerencia/operaciones) lo aplica la ruta.
 */
import type { KpiDefinicion, KpiMedicion, Reproceso, Reprogramacion } from '@backio/shared';
import { type DbCtx, serviceClient, throwIf } from './client';

export async function listDefiniciones(ctx: DbCtx, soloActivas = false): Promise<KpiDefinicion[]> {
  let q = serviceClient().from('kpi_definiciones').select('*').eq('tenant_id', ctx.tenantId).order('area').order('orden');
  if (soloActivas) q = q.eq('activo', true);
  const { data, error } = await q;
  throwIf(error);
  return ((data ?? []) as KpiDefinicion[]).map((d) => ({ ...d, meta: Number(d.meta), denominador_fijo: d.denominador_fijo === null ? null : Number(d.denominador_fijo) }));
}

export async function guardarDefinicion(ctx: DbCtx, codigo: string, patch: Partial<Omit<KpiDefinicion, 'id' | 'tenant_id' | 'codigo'>>): Promise<KpiDefinicion> {
  const { data, error } = await serviceClient().from('kpi_definiciones').update(patch).eq('tenant_id', ctx.tenantId).eq('codigo', codigo).select().single();
  throwIf(error);
  return data as KpiDefinicion;
}

export async function listMediciones(ctx: DbCtx, periodos: string[]): Promise<KpiMedicion[]> {
  if (!periodos.length) return [];
  const { data, error } = await serviceClient().from('kpi_mediciones').select('*').eq('tenant_id', ctx.tenantId).in('periodo', periodos);
  throwIf(error);
  return ((data ?? []) as KpiMedicion[]).map((m) => ({ ...m, dato_a: m.dato_a === null ? null : Number(m.dato_a), dato_b: m.dato_b === null ? null : Number(m.dato_b), meta_individual: m.meta_individual === null ? null : Number(m.meta_individual), tasa_respuesta: m.tasa_respuesta === null ? null : Number(m.tasa_respuesta) }));
}

/** Upsert por (kpi, periodo, usuario|equipo). No usa onConflict porque la clave única es una expresión (coalesce). */
export async function guardarMedicion(ctx: DbCtx, m: Omit<Partial<KpiMedicion>, 'id' | 'tenant_id'> & { kpi_id: string; periodo: string; usuario_id: string | null }): Promise<KpiMedicion> {
  const db = serviceClient();
  let q = db.from('kpi_mediciones').select('id').eq('tenant_id', ctx.tenantId).eq('kpi_id', m.kpi_id).eq('periodo', m.periodo);
  q = m.usuario_id ? q.eq('usuario_id', m.usuario_id) : q.is('usuario_id', null);
  const { data: ex, error: e1 } = await q.maybeSingle();
  throwIf(e1);
  const fila = { ...m, tenant_id: ctx.tenantId, registrado_por: ctx.usuarioId };
  const { data, error } = ex
    ? await db.from('kpi_mediciones').update(fila).eq('id', (ex as { id: string }).id).select().single()
    : await db.from('kpi_mediciones').insert(fila).select().single();
  throwIf(error);
  return data as KpiMedicion;
}

export async function borrarMedicion(ctx: DbCtx, id: string): Promise<void> {
  const { error } = await serviceClient().from('kpi_mediciones').delete().eq('tenant_id', ctx.tenantId).eq('id', id);
  throwIf(error);
}

/** Campos de la tarea que usan los calculadores. */
export interface ReqKpi {
  id: string; titulo_interno: string; cliente_id: string; proyecto_id: string | null; owner_agencia: string[];
  prioridad: 'alta' | 'media' | 'baja'; estado_operativo: string; estado_aprobacion: string;
  fecha_entrega: string | null; fecha_entrega_original: string | null; completado_at: string | null; created_at: string;
  clase: 'tarea' | 'propuesta' | 'incidencia'; proactiva: boolean; primera_respuesta_at: string | null; basecamp_url: string | null;
}
const CAMPOS = 'id, titulo_interno, cliente_id, proyecto_id, owner_agencia, prioridad, estado_operativo, estado_aprobacion, fecha_entrega, fecha_entrega_original, completado_at, created_at, clase, proactiva, primera_respuesta_at, basecamp_url';

async function paginar<T>(consulta: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await consulta(from, from + 999);
    throwIf(error as never);
    const filas = (data ?? []) as T[];
    out.push(...filas);
    if (filas.length < 1000) break;
  }
  return out;
}

export interface DatosKpi {
  completadas: ReqKpi[];
  creadas: ReqKpi[];
  decididas: ReqKpi[];
  reprocesos: Reproceso[];
  reprogramaciones: Reprogramacion[];
  eventos: { requerimiento_id: string; estado_a: string; ronda: number; created_at: string }[];
  ejecutivaProyecto: Map<string, string>;
  clientes: Map<string, string>;
}

/** Todo lo que necesitan los calculadores para el rango [desdeIso, hastaIso). */
export async function cargarDatosKpi(ctx: DbCtx, desdeIso: string, hastaIso: string): Promise<DatosKpi> {
  const db = serviceClient(); const T = ctx.tenantId;
  const [completadas, creadas, eventos] = await Promise.all([
    paginar<ReqKpi>((a, b) => db.from('requerimientos').select(CAMPOS).eq('tenant_id', T).is('deleted_at', null).eq('estado_operativo', 'completado').gte('completado_at', desdeIso).lt('completado_at', hastaIso).order('id').range(a, b)),
    paginar<ReqKpi>((a, b) => db.from('requerimientos').select(CAMPOS).eq('tenant_id', T).is('deleted_at', null).neq('estado_operativo', 'cancelado').gte('created_at', desdeIso).lt('created_at', hastaIso).order('id').range(a, b)),
    paginar<DatosKpi['eventos'][number]>((a, b) => db.from('aprobacion_eventos').select('requerimiento_id, estado_a, ronda, created_at').eq('tenant_id', T).in('estado_a', ['aprobado', 'rechazado']).gte('created_at', desdeIso).lt('created_at', hastaIso).order('created_at').range(a, b)),
  ]);
  // Tareas con decisión de aprobación en el rango que no estén ya cargadas.
  const conocidas = new Set([...completadas, ...creadas].map((r) => r.id));
  const faltan = [...new Set(eventos.map((e) => e.requerimiento_id))].filter((id) => !conocidas.has(id));
  const decididas: ReqKpi[] = [...completadas, ...creadas];
  for (let i = 0; i < faltan.length; i += 200) {
    const { data, error } = await db.from('requerimientos').select(CAMPOS).eq('tenant_id', T).is('deleted_at', null).in('id', faltan.slice(i, i + 200));
    throwIf(error);
    decididas.push(...((data ?? []) as ReqKpi[]));
  }
  const ids = [...new Set(decididas.map((r) => r.id))];
  const reprocesos: Reproceso[] = [], reprogramaciones: Reprogramacion[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const lote = ids.slice(i, i + 200);
    const [{ data: rp, error: e1 }, { data: rg, error: e2 }] = await Promise.all([
      db.from('reprocesos').select('*').eq('tenant_id', T).in('requerimiento_id', lote),
      db.from('reprogramaciones').select('*').eq('tenant_id', T).in('requerimiento_id', lote),
    ]);
    throwIf(e1); throwIf(e2);
    reprocesos.push(...((rp ?? []) as Reproceso[])); reprogramaciones.push(...((rg ?? []) as Reprogramacion[]));
  }
  const [{ data: pr, error: e3 }, { data: cl, error: e4 }] = await Promise.all([
    db.from('proyectos').select('id, owner_ejecutiva').eq('tenant_id', T).not('owner_ejecutiva', 'is', null),
    db.from('clientes').select('id, nombre').eq('tenant_id', T),
  ]);
  throwIf(e3); throwIf(e4);
  return {
    completadas, creadas, decididas: [...new Map(decididas.map((r) => [r.id, r])).values()], reprocesos, reprogramaciones, eventos,
    ejecutivaProyecto: new Map(((pr ?? []) as { id: string; owner_ejecutiva: string }[]).map((p) => [p.id, p.owner_ejecutiva])),
    clientes: new Map(((cl ?? []) as { id: string; nombre: string }[]).map((c) => [c.id, c.nombre])),
  };
}
