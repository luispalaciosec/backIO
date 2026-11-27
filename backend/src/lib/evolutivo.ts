/**
 * Evolutivo de rituales (26/09/2026, docs/05-rituales.md «Evolutivo»).
 * Foto diaria y semanal por mesa: las métricas del cierre del daily y del weekly quedan guardadas para ver
 * la evolución del mes. Lo anterior al despliegue se reconstruye desde la auditoría (origen «reconstruido»).
 */
import type { Mesa } from '@backio/shared';
import {
  MOTIVOS_REPROGRAMACION,
  diaLocal,
  hoyLocal,
  inicioDiaLocal,
  porcentaje,
  sumarDias,
  cerradaATiempo,
  entregaReal,
  responsablesDe,
  nombrePersona,
} from '@backio/shared';
import type { DbCtx } from './db/client';
import { alcanceMesa, listMesas } from './db/mesas';
import { listUsuarios } from './db/usuarios';
import { ensureSemana } from './db/semanas';
import {
  datosSemanaMesa,
  getDailySnapshot,
  getWeeklySnapshot,
  guardarDailySnapshot,
  guardarWeeklySnapshot,
  listDailySnapshots,
  listEventosBloqueo,
  listEventosDailyFecha,
  listEventosEstado,
  listHorasPorTareaDesde,
  listEventosCierre,
  listDailySnapshotsParaRecalcular,
  actualizarMetricasSnapshot,
  listPublicacionesDaily,
  listReprocesosDesde,
  listReprogramacionesDesde,
  listTareasEvolutivo,
  listWeeklySnapshots,
} from './db/evolutivo';

// ---------------------------------------------------------------- tipos
export interface TareaEvo {
  id: string;
  owner_agencia: string[];
  estado_operativo: string;
  completado_at: string | null;
  created_at: string;
  planificacion: string | null;
  fecha_entrega: string | null;
  fecha_entrega_original: string | null;
  daily_fecha: string | null;
  /** Día real del pedido. En lo importado de Basecamp es la fecha de creación del to-do, no la de importación. */
  fecha_pedido?: string | null;
  responsables_cierre?: string[] | null;
  heredada?: boolean;
  entregado_el?: string | null;
}
export interface EventoSeleccion {
  requerimiento_id: string;
  valor: string | null;
  at: string;
}
export interface MetricasDia {
  /** Todo lo elegido para el día (para entregar hoy y en curso). */
  planificadas: number;
  /** Elegidas que se entregaban ese día (o antes), o que se cerraron ese día: sobre estas se mide el cumplimiento. */
  para_hoy?: number;
  /** Elegidas que se entregan otro día (trabajo de varios días): no cuentan contra el cumplimiento. */
  en_curso?: number;
  /** De las en curso, las que tuvieron horas del timesheet o un cambio de estado ese día. */
  en_curso_con_avance?: number;
  cerradas_planificadas: number;
  cumplimiento_pct: number | null;
  cerradas_fuera: number;
  cerradas_total: number;
  nuevas_hoy: number;
  nuevas_no_planificadas: number;
  nuevas_urgentes: number;
  reprocesos_hoy: number;
  reprogramaciones_24h: number;
  bloqueos_nuevos: number;
  vencidas_abiertas: number;
}
export interface PersonaDia {
  usuario_id: string;
  nombre: string;
  planificadas: number;
  para_hoy?: number;
  en_curso?: number;
  con_avance?: number;
  cerradas: number;
  fuera: number;
}
export interface MetricasSemana {
  comprometidas: number;
  a_tiempo_original: number;
  a_tiempo_vigente: number;
  pct_a_tiempo_original: number | null;
  pct_a_tiempo_vigente: number | null;
  arrastre: number;
  cerradas: number;
  plan_tareas: number | null;
  plan_cumplidas: number | null;
  pct_plan: number | null;
  reprocesos: number;
  reprogramaciones: number;
  reprogramaciones_equipo: number;
  reprogramaciones_cliente: number;
  senales_criticas: number;
  senales_altas: number;
  senales_medias: number;
  senales_atendidas: number;
  acuerdos: number;
  acuerdos_cumplidos: number;
  acuerdos_a_tiempo: number;
  dailies_apertura: number;
  dailies_cierre: number;
  dias_habiles: number;
}

// ---------------------------------------------------------------- utilidades de fecha (Guayaquil)
export const inicioDia = inicioDiaLocal;
export const finDia = (dia: string) => inicioDia(sumarDias(dia, 1));
const enRango = (iso: string | null | undefined, desde: string, hasta: string) => !!iso && iso >= desde && iso < hasta;
export const esHabil = (dia: string) => {
  const d = new Date(`${dia}T12:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6;
};
export function diasHabiles(desde: string, hasta: string): string[] {
  const out: string[] = [];
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) if (esHabil(d)) out.push(d);
  return out;
}

// ---------------------------------------------------------------- cálculo puro
/**
 * Selección del daily de `dia` según los eventos de auditoría hasta `corte`: vale el último valor de
 * daily_fecha de cada tarea antes del corte. Una tarea sin ningún evento conserva su daily_fecha actual.
 */
export function reconstruirSeleccion(
  dia: string,
  corte: string,
  eventos: EventoSeleccion[],
  tareas: Pick<TareaEvo, 'id' | 'daily_fecha'>[],
): Set<string> {
  const ultimo = new Map<string, EventoSeleccion>();
  const conEventos = new Set<string>();
  for (const e of eventos) {
    conEventos.add(e.requerimiento_id);
    if (e.at > corte) continue;
    const prev = ultimo.get(e.requerimiento_id);
    if (!prev || e.at >= prev.at) ultimo.set(e.requerimiento_id, e);
  }
  const sel = new Set<string>();
  for (const [id, e] of ultimo) if (e.valor === dia) sel.add(id);
  for (const t of tareas) if (!conEventos.has(t.id) && t.daily_fecha === dia) sel.add(t.id);
  return sel;
}

export function metricasDia(p: {
  dia: string;
  seleccion: Set<string>;
  tareas: TareaEvo[];
  reprocesos: { requerimiento_id: string; abierto_at: string }[];
  reprogramaciones: { requerimiento_id: string; created_at: string }[];
  bloqueos: number;
  nombres: Map<string, string>;
  /** Tareas con horas del timesheet o un cambio de estado ese día. */
  avance?: Set<string>;
  /** Tareas con un cierre registrado ese día, aunque después se hayan reabierto. */
  cierres?: Set<string>;
}): { metricas: MetricasDia; por_persona: PersonaDia[] } {
  const desde = inicioDia(p.dia),
    hasta = finDia(p.dia);
  const cerradaEseDia = (t: TareaEvo) => enRango(t.completado_at, desde, hasta) || !!p.cierres?.has(t.id);
  const ids = new Set(p.tareas.map((t) => t.id));
  const cerradasHoy = p.tareas.filter(cerradaEseDia);
  const planificadas = p.tareas.filter((t) => p.seleccion.has(t.id));
  const cerradasPlan = planificadas.filter(cerradaEseDia);
  // Pedido de Carolina (27/11): elegir una tarea para hoy no es comprometer su entrega hoy. Un guion o una gráfica con
  // revisiones se trabaja lunes, martes y miércoles y se entrega el miércoles: lunes y martes está «en curso», no
  // incumplida. El cumplimiento se mide sobre lo que se entregaba ese día (o antes) y sobre lo que se cerró ese día.
  const esParaHoy = (t: TareaEvo) => cerradaEseDia(t) || (!!t.fecha_entrega && t.fecha_entrega <= p.dia);
  const paraHoy = planificadas.filter(esParaHoy);
  const enCurso = planificadas.filter((t) => !esParaHoy(t));
  const conAvance = (t: TareaEvo) => !!p.avance?.has(t.id);
  const fuera = cerradasHoy.filter((t) => !p.seleccion.has(t.id));
  // Nueva = pedida ese día (fecha_pedido); una importación masiva no cuenta como trabajo nuevo.
  const nuevas = p.tareas.filter(
    (t) => t.estado_operativo !== 'cancelado' && enRango(t.created_at, desde, hasta) && (!t.fecha_pedido || t.fecha_pedido === p.dia),
  );
  // Completada sin fecha de cierre = histórico importado: se cerró antes de cualquier periodo medido.
  const cerradaAntes = (t: TareaEvo) => (t.completado_at ? t.completado_at < hasta : t.estado_operativo === 'completado');
  const vencidas = p.tareas.filter(
    (t) => t.estado_operativo !== 'cancelado' && t.fecha_entrega && t.fecha_entrega < p.dia && t.created_at < hasta && !cerradaAntes(t),
  );
  const porPersona = new Map<string, PersonaDia>();
  const pp = (id: string) => {
    if (!porPersona.has(id))
      porPersona.set(id, {
        usuario_id: id,
        nombre: p.nombres.get(id) ?? '—',
        planificadas: 0,
        para_hoy: 0,
        en_curso: 0,
        con_avance: 0,
        cerradas: 0,
        fuera: 0,
      });
    return porPersona.get(id)!;
  };
  for (const t of planificadas)
    for (const o of responsablesDe(t)) {
      const x = pp(o);
      x.planificadas += 1;
      if (esParaHoy(t)) x.para_hoy = (x.para_hoy ?? 0) + 1;
      else {
        x.en_curso = (x.en_curso ?? 0) + 1;
        if (conAvance(t)) x.con_avance = (x.con_avance ?? 0) + 1;
      }
      if (cerradaEseDia(t)) x.cerradas += 1;
    }
  for (const t of fuera) for (const o of responsablesDe(t)) pp(o).fuera += 1;
  return {
    metricas: {
      planificadas: planificadas.length,
      para_hoy: paraHoy.length,
      en_curso: enCurso.length,
      en_curso_con_avance: enCurso.filter(conAvance).length,
      cerradas_planificadas: cerradasPlan.length,
      cumplimiento_pct: porcentaje(cerradasPlan.length, paraHoy.length),
      cerradas_fuera: fuera.length,
      cerradas_total: cerradasHoy.length,
      nuevas_hoy: nuevas.length,
      nuevas_no_planificadas: nuevas.filter((t) => t.planificacion === 'no_planificado').length,
      nuevas_urgentes: nuevas.filter((t) => t.planificacion === 'urgente').length,
      reprocesos_hoy: p.reprocesos.filter((r) => ids.has(r.requerimiento_id) && enRango(r.abierto_at, desde, hasta)).length,
      reprogramaciones_24h: p.reprogramaciones.filter((r) => ids.has(r.requerimiento_id) && enRango(r.created_at, desde, hasta)).length,
      bloqueos_nuevos: p.bloqueos,
      vencidas_abiertas: vencidas.length,
    },
    por_persona: [...porPersona.values()].sort((a, b) => b.planificadas - a.planificadas || a.nombre.localeCompare(b.nombre, 'es')),
  };
}

export function metricasSemana(p: {
  inicio: string;
  fin: string;
  tareas: TareaEvo[];
  reprocesos: { requerimiento_id: string; abierto_at: string }[];
  reprogramaciones: { requerimiento_id: string; created_at: string; motivo: string | null }[];
  senales: { severidad: string; atendida: boolean }[];
  acuerdos: { estado: string; fecha_compromiso: string; cerrado_at: string | null }[];
  planIds: string[] | null;
  dailies: { apertura: number; cierre: number };
}): MetricasSemana {
  const desde = inicioDia(p.inicio),
    hasta = finDia(p.fin);
  const ids = new Set(p.tareas.map((t) => t.id));
  // Completadas sin fecha de cierre (histórico importado) no se pueden medir: quedan fuera.
  const comprometidas = p.tareas.filter(
    (t) =>
      t.estado_operativo !== 'cancelado' &&
      !(t.estado_operativo === 'completado' && !t.completado_at) &&
      t.fecha_entrega_original &&
      t.fecha_entrega_original >= p.inicio &&
      t.fecha_entrega_original <= p.fin &&
      // Heredada por una salida y cerrada tarde: ese atraso no cuenta (docs/20).
      !(t.heredada && cerradaATiempo(entregaReal(t), t.fecha_entrega_original, true) === null && !!t.completado_at),
  );
  const hechaAntes = (t: TareaEvo, fecha: string | null) => cerradaATiempo(entregaReal(t), fecha) === true;
  const aOrig = comprometidas.filter((t) => hechaAntes(t, t.fecha_entrega_original)).length;
  const aVig = comprometidas.filter((t) => hechaAntes(t, t.fecha_entrega)).length;
  const porId = new Map(p.tareas.map((t) => [t.id, t]));
  const plan = p.planIds ? p.planIds.filter((id) => porId.has(id)) : null;
  const planOk = plan
    ? plan.filter((id) => {
        const t = porId.get(id)!;
        return !!t.completado_at && t.completado_at < hasta;
      }).length
    : null;
  const reprogs = p.reprogramaciones.filter((r) => ids.has(r.requerimiento_id) && enRango(r.created_at, desde, hasta));
  const atrib = (m: string | null) => MOTIVOS_REPROGRAMACION.find((x) => x.valor === m)?.atribuible;
  return {
    comprometidas: comprometidas.length,
    a_tiempo_original: aOrig,
    a_tiempo_vigente: aVig,
    pct_a_tiempo_original: porcentaje(aOrig, comprometidas.length),
    pct_a_tiempo_vigente: porcentaje(aVig, comprometidas.length),
    arrastre: comprometidas.filter((t) => !(t.completado_at && t.completado_at < hasta)).length,
    cerradas: p.tareas.filter((t) => enRango(t.completado_at, desde, hasta)).length,
    plan_tareas: plan ? plan.length : null,
    plan_cumplidas: planOk,
    pct_plan: plan && plan.length ? porcentaje(planOk ?? 0, plan.length) : null,
    reprocesos: p.reprocesos.filter((r) => ids.has(r.requerimiento_id) && enRango(r.abierto_at, desde, hasta)).length,
    reprogramaciones: reprogs.length,
    reprogramaciones_equipo: reprogs.filter((r) => atrib(r.motivo) === 'equipo').length,
    reprogramaciones_cliente: reprogs.filter((r) => atrib(r.motivo) === 'cliente').length,
    senales_criticas: p.senales.filter((s) => s.severidad === 'critica').length,
    senales_altas: p.senales.filter((s) => s.severidad === 'alta').length,
    senales_medias: p.senales.filter((s) => s.severidad === 'media').length,
    senales_atendidas: p.senales.filter((s) => s.atendida).length,
    acuerdos: p.acuerdos.length,
    acuerdos_cumplidos: p.acuerdos.filter((a) => a.estado === 'cumplido').length,
    acuerdos_a_tiempo: p.acuerdos.filter((a) => a.estado === 'cumplido' && a.cerrado_at && diaLocal(a.cerrado_at) <= a.fecha_compromiso)
      .length,
    dailies_apertura: p.dailies.apertura,
    dailies_cierre: p.dailies.cierre,
    dias_habiles: diasHabiles(p.inicio, p.fin).length,
  };
}

// ---------------------------------------------------------------- carga por mesa
interface DatosMesa {
  mesa: Mesa;
  tareas: TareaEvo[];
  reprocesos: { requerimiento_id: string; abierto_at: string }[];
  reprogramaciones: { requerimiento_id: string; created_at: string; motivo: string | null }[];
  eventos: EventoSeleccion[];
  bloqueos: { requerimiento_id: string; at: string }[];
  publicaciones: { tipo: 'apertura' | 'cierre'; at: string; message_id: number | null }[];
  nombres: Map<string, string>;
  /** Día (Guayaquil) en que cada tarea tuvo horas o un cambio de estado. */
  avance: { requerimiento_id: string; dia: string }[];
  /** Día (Guayaquil) de cada cierre registrado, aunque la tarea se haya reabierto después. */
  cierres: { requerimiento_id: string; dia: string }[];
}

export async function cargarMesa(ctx: DbCtx, mesa: Mesa, desdeIso: string): Promise<DatosMesa> {
  const alc = await alcanceMesa(ctx, mesa.id, { sinPrueba: true });
  const partes = [
    ...(alc.clienteIds.length ? [`cliente_id.in.(${alc.clienteIds.join(',')})`] : []),
    ...(alc.proyectoIds.length ? [`proyecto_id.in.(${alc.proyectoIds.join(',')})`] : []),
  ];
  const tareas = partes.length ? await listTareasEvolutivo(ctx, partes) : [];
  const ids = new Set(tareas.map((t) => t.id));
  const [rp, rg, ev, bl, pub, usuarios, est, hs, ci] = await Promise.all([
    listReprocesosDesde(ctx, desdeIso),
    listReprogramacionesDesde(ctx, desdeIso),
    listEventosDailyFecha(ctx, desdeIso),
    listEventosBloqueo(ctx, desdeIso),
    listPublicacionesDaily(ctx, mesa.id, desdeIso),
    listUsuarios(ctx, { incluirInactivos: true }),
    listEventosEstado(ctx, desdeIso),
    listHorasPorTareaDesde(ctx, diaLocal(desdeIso)),
    listEventosCierre(ctx, desdeIso),
  ]);
  return {
    mesa,
    tareas,
    reprocesos: rp.filter((r) => ids.has(r.requerimiento_id)),
    reprogramaciones: rg.filter((r) => ids.has(r.requerimiento_id)),
    eventos: ev
      .filter((e) => ids.has(e.entidad_id))
      .map((e) => ({ requerimiento_id: e.entidad_id, valor: e.detalle?.daily_fecha ?? null, at: e.created_at })),
    bloqueos: bl.filter((e) => ids.has(e.entidad_id)).map((e) => ({ requerimiento_id: e.entidad_id, at: e.created_at })),
    publicaciones: pub.map((x) => ({
      tipo: x.accion === 'publicar_daily_cierre' ? 'cierre' : 'apertura',
      at: x.created_at,
      message_id: x.detalle?.message_id ?? null,
    })),
    nombres: new Map(usuarios.map((u) => [u.id, nombrePersona(u)])),
    avance: [
      ...est.filter((e) => ids.has(e.entidad_id)).map((e) => ({ requerimiento_id: e.entidad_id, dia: diaLocal(e.created_at) })),
      ...hs.filter((h) => ids.has(h.requerimiento_id)).map((h) => ({ requerimiento_id: h.requerimiento_id, dia: h.fecha })),
    ],
    cierres: ci
      .filter((e) => ids.has(e.entidad_id))
      .map((e) => ({ requerimiento_id: e.entidad_id, dia: diaLocal(e.detalle?.completed_at ?? e.created_at) })),
  };
}

/** Foto de un día a partir de los datos de la mesa. `reconstruir` usa la auditoría; si no, la selección actual. */
export function fotoDeDia(d: DatosMesa, dia: string, reconstruir: boolean) {
  const desde = inicioDia(dia),
    hasta = finDia(dia);
  const pubs = d.publicaciones.filter((x) => enRango(x.at, desde, hasta));
  const cierre = [...pubs].reverse().find((x) => x.tipo === 'cierre') ?? null;
  // Corte: la hora del cierre publicado, o el fin del día.
  const corte = cierre?.at ?? hasta;
  const seleccion = reconstruir
    ? reconstruirSeleccion(dia, corte, d.eventos, d.tareas)
    : new Set(d.tareas.filter((t) => t.daily_fecha === dia).map((t) => t.id));
  const bloqueos = new Set(d.bloqueos.filter((b) => enRango(b.at, desde, hasta)).map((b) => b.requerimiento_id)).size;
  const { metricas, por_persona } = metricasDia({
    dia,
    seleccion,
    tareas: d.tareas,
    reprocesos: d.reprocesos,
    reprogramaciones: d.reprogramaciones,
    bloqueos,
    nombres: d.nombres,
    avance: new Set(d.avance.filter((a) => a.dia === dia).map((a) => a.requerimiento_id)),
    cierres: new Set(d.cierres.filter((c) => c.dia === dia).map((c) => c.requerimiento_id)),
  });
  return {
    metricas,
    por_persona,
    seleccion: [...seleccion],
    publicado: !!cierre,
    apertura_publicada: pubs.some((x) => x.tipo === 'apertura'),
    message_id: cierre?.message_id ?? null,
  };
}

async function guardarDia(
  ctx: DbCtx,
  mesaId: string,
  dia: string,
  f: ReturnType<typeof fotoDeDia>,
  origen: 'cierre' | 'cron' | 'reconstruido',
) {
  const fila = {
    tenant_id: ctx.tenantId,
    mesa_id: mesaId,
    fecha: dia,
    metricas: f.metricas,
    seleccion: f.seleccion,
    por_persona: f.por_persona,
    publicado: f.publicado,
    apertura_publicada: f.apertura_publicada,
    message_id: f.message_id,
  };
  const e = await getDailySnapshot(ctx, mesaId, dia);
  // Una foto tomada en vivo (cierre/cron) no se reemplaza por una reconstruida, y la del cierre publicado no la pisa la
  // tarea programada de las 19:30 (que es solo para los días sin cierre; revisión del 28/10/2026).
  if (e && origen === 'reconstruido' && e.origen !== 'reconstruido') return;
  if (e && origen === 'cron' && e.origen === 'cierre') return;
  await guardarDailySnapshot(e?.id ?? null, { ...fila, origen: f.publicado && origen !== 'reconstruido' ? 'cierre' : origen });
}

/** Foto del día (cierre publicado o cron de las 19:30). */
export async function fotoDaily(ctx: DbCtx, mesa: Mesa, dia = hoyLocal(), origen: 'cierre' | 'cron' = 'cron'): Promise<MetricasDia> {
  const d = await cargarMesa(ctx, mesa, inicioDia(sumarDias(dia, -1)));
  const f = fotoDeDia(d, dia, false);
  await guardarDia(ctx, mesa.id, dia, f, origen);
  return f.metricas;
}

/** Semana ISO (lunes a domingo) que contiene `dia`. */
export function semanaDe(dia: string): { inicio: string; fin: string } {
  const dow = (new Date(`${dia}T12:00:00Z`).getUTCDay() + 6) % 7;
  const inicio = sumarDias(dia, -dow);
  return { inicio, fin: sumarDias(inicio, 6) };
}

export async function calcularSemana(
  ctx: DbCtx,
  d: DatosMesa,
  inicio: string,
  fin: string,
): Promise<{ semana_id: string; metricas: MetricasSemana }> {
  const semana = await ensureSemana(ctx, inicio);
  const ids = new Set(d.tareas.map((t) => t.id));
  const alc = await alcanceMesa(ctx, d.mesa.id, { sinPrueba: true });
  const clientes = new Set(alc.clienteIds);
  const { senales: sen, acuerdos: acu, acta } = await datosSemanaMesa(ctx, semana.id, d.mesa.id);
  const senales = ((sen ?? []) as { severidad: string; atendida: boolean; entidad_tipo: string; entidad_id: string }[]).filter(
    (s) => (s.entidad_tipo === 'requerimiento' && ids.has(s.entidad_id)) || (s.entidad_tipo === 'cliente' && clientes.has(s.entidad_id)),
  );
  const planIds = acta ? ((acta as { contenido: { prioridades?: { id: string }[] } }).contenido?.prioridades ?? []).map((x) => x.id) : null;
  const pubs = d.publicaciones.filter((x) => enRango(x.at, inicioDia(inicio), finDia(fin)));
  const diasCon = (tipo: 'apertura' | 'cierre') => new Set(pubs.filter((x) => x.tipo === tipo).map((x) => diaLocal(x.at))).size;
  return {
    semana_id: semana.id,
    metricas: metricasSemana({
      inicio,
      fin,
      tareas: d.tareas,
      reprocesos: d.reprocesos,
      reprogramaciones: d.reprogramaciones,
      senales,
      acuerdos: (acu ?? []) as { estado: string; fecha_compromiso: string; cerrado_at: string | null }[],
      planIds,
      dailies: { apertura: diasCon('apertura'), cierre: diasCon('cierre') },
    }),
  };
}

async function guardarSemana(
  ctx: DbCtx,
  mesaId: string,
  inicio: string,
  fin: string,
  s: { semana_id: string; metricas: MetricasSemana },
  origen: 'cron' | 'reconstruido',
) {
  const e = await getWeeklySnapshot(ctx, mesaId, s.semana_id);
  if (e && origen === 'reconstruido' && e.origen !== 'reconstruido') return;
  const fila = {
    tenant_id: ctx.tenantId,
    mesa_id: mesaId,
    semana_id: s.semana_id,
    fecha_inicio: inicio,
    fecha_fin: fin,
    metricas: s.metricas,
    origen,
  };
  await guardarWeeklySnapshot(e?.id ?? null, fila);
}

/** Foto de la semana que cierra (domingo) para cada mesa activa. */
export async function fotoWeekly(ctx: DbCtx, dia = hoyLocal()): Promise<number> {
  const { inicio, fin } = semanaDe(dia);
  let n = 0;
  for (const mesa of (await listMesas(ctx)).filter((m) => m.activa)) {
    const d = await cargarMesa(ctx, mesa, inicioDia(sumarDias(inicio, -7)));
    await guardarSemana(ctx, mesa.id, inicio, fin, await calcularSemana(ctx, d, inicio, fin), 'cron');
    n += 1;
  }
  return n;
}

/** Rehace días hábiles y semanas desde `desde` hasta ayer. Idempotente; no pisa fotos tomadas en vivo. */
export async function reconstruirDesde(ctx: DbCtx, desde: string): Promise<{ dias: number; semanas: number }> {
  const ayer = sumarDias(hoyLocal(), -1);
  let dias = 0,
    semanas = 0;
  for (const mesa of (await listMesas(ctx)).filter((m) => m.activa)) {
    const d = await cargarMesa(ctx, mesa, inicioDia(sumarDias(desde, -7)));
    for (const dia of diasHabiles(desde, ayer)) {
      await guardarDia(ctx, mesa.id, dia, fotoDeDia(d, dia, true), 'reconstruido');
      dias += 1;
    }
    for (let s = semanaDe(desde); s.fin <= ayer; s = semanaDe(sumarDias(s.fin, 1))) {
      await guardarSemana(ctx, mesa.id, s.inicio, s.fin, await calcularSemana(ctx, d, s.inicio, s.fin), 'reconstruido');
      semanas += 1;
    }
  }
  return { dias, semanas };
}

/**
 * Recalcula las métricas de todas las fotos diarias desde `desde` con la regla vigente, sobre la selección que cada foto
 * guardó (no se reconstruye nada). No cambia el origen ni lo publicado en Basecamp. Pedido de gerencia del 27/11/2026:
 * «en curso» se aplica a toda la historia.
 */
export async function recalcularDesde(ctx: DbCtx, desde: string): Promise<{ fotos: number }> {
  let fotos = 0;
  for (const mesa of await listMesas(ctx)) {
    const snaps = await listDailySnapshotsParaRecalcular(ctx, mesa.id, desde);
    if (!snaps.length) continue;
    const d = await cargarMesa(ctx, mesa, inicioDia(sumarDias(snaps[0]!.fecha, -7)));
    for (const sn of snaps) {
      const desdeD = inicioDia(sn.fecha),
        hastaD = finDia(sn.fecha);
      const { metricas, por_persona } = metricasDia({
        dia: sn.fecha,
        seleccion: new Set(sn.seleccion ?? []),
        tareas: d.tareas,
        reprocesos: d.reprocesos,
        reprogramaciones: d.reprogramaciones,
        bloqueos: new Set(d.bloqueos.filter((b) => enRango(b.at, desdeD, hastaD)).map((b) => b.requerimiento_id)).size,
        nombres: d.nombres,
        avance: new Set(d.avance.filter((a) => a.dia === sn.fecha).map((a) => a.requerimiento_id)),
        cierres: new Set(d.cierres.filter((c) => c.dia === sn.fecha).map((c) => c.requerimiento_id)),
      });
      await actualizarMetricasSnapshot(ctx, sn.id, metricas, por_persona);
      fotos += 1;
    }
  }
  return { fotos };
}

// ---------------------------------------------------------------- lectura para la pantalla
export interface EvolutivoMes {
  mesa: { id: string; nombre: string };
  mes: string;
  dias: {
    fecha: string;
    metricas: MetricasDia;
    por_persona: PersonaDia[];
    origen: string;
    publicado: boolean;
    apertura_publicada: boolean;
    en_vivo?: boolean;
  }[];
  semanas: { fecha_inicio: string; fecha_fin: string; metricas: MetricasSemana; origen: string; en_vivo?: boolean }[];
  resumen: ResumenMes;
  resumen_anterior: ResumenMes | null;
}
export interface ResumenMes {
  dias: number;
  dias_con_cierre: number;
  planificadas: number;
  cerradas_planificadas: number;
  cumplimiento_pct: number | null;
  cerradas_fuera: number;
  cerradas_total: number;
  fuera_de_plan: number;
  reprocesos: number;
  reprogramaciones: number;
  vencidas_promedio: number | null;
}

export function resumir(dias: { metricas: MetricasDia; publicado: boolean }[]): ResumenMes {
  const s = (k: keyof MetricasDia) => dias.reduce((acc, d) => acc + (Number(d.metricas[k]) || 0), 0);
  // Desde el 27/11 el cumplimiento se mide sobre lo que se entregaba cada día; una foto sin `para_hoy` usa lo elegido.
  const plan = dias.reduce((acc, d) => acc + (d.metricas.para_hoy ?? d.metricas.planificadas), 0),
    ok = s('cerradas_planificadas');
  return {
    dias: dias.length,
    dias_con_cierre: dias.filter((d) => d.publicado).length,
    planificadas: plan,
    cerradas_planificadas: ok,
    cumplimiento_pct: porcentaje(ok, plan),
    cerradas_fuera: s('cerradas_fuera'),
    cerradas_total: s('cerradas_total'),
    fuera_de_plan: s('nuevas_no_planificadas') + s('nuevas_urgentes'),
    reprocesos: s('reprocesos_hoy'),
    reprogramaciones: s('reprogramaciones_24h'),
    vencidas_promedio: dias.length ? Math.round((s('vencidas_abiertas') / dias.length) * 10) / 10 : null,
  };
}

export async function evolutivoMes(ctx: DbCtx, mesa: Mesa, mes: string): Promise<EvolutivoMes> {
  const ini = `${mes}-01`;
  const finMes = sumarDias(`${new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 1)).toISOString().slice(0, 10)}`, -1);
  const antIni = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 2, 1)).toISOString().slice(0, 10);
  const [ds, ws] = await Promise.all([listDailySnapshots(ctx, mesa.id, antIni, finMes), listWeeklySnapshots(ctx, mesa.id, ini, finMes)]);
  const todos = ds as EvolutivoMes['dias'];
  const dias = todos.filter((x) => x.fecha >= ini);
  const semanas = ws as EvolutivoMes['semanas'];
  // Hoy y la semana en curso: en vivo (aún no hay foto).
  const hoy = hoyLocal();
  if (hoy >= ini && hoy <= finMes) {
    const d = await cargarMesa(ctx, mesa, inicioDia(sumarDias(semanaDe(hoy).inicio, -7)));
    if (esHabil(hoy) && !dias.some((x) => x.fecha === hoy)) {
      const f = fotoDeDia(d, hoy, false);
      dias.push({
        fecha: hoy,
        metricas: f.metricas,
        por_persona: f.por_persona,
        origen: 'en_vivo',
        publicado: f.publicado,
        apertura_publicada: f.apertura_publicada,
        en_vivo: true,
      });
    }
    const s = semanaDe(hoy);
    if (!semanas.some((x) => x.fecha_inicio === s.inicio)) {
      const c = await calcularSemana(ctx, d, s.inicio, s.fin);
      semanas.push({ fecha_inicio: s.inicio, fecha_fin: s.fin, metricas: c.metricas, origen: 'en_vivo', en_vivo: true });
    }
  }
  const anteriores = todos.filter((x) => x.fecha < ini);
  return {
    mesa: { id: mesa.id, nombre: mesa.nombre },
    mes,
    dias,
    semanas,
    resumen: resumir(dias),
    resumen_anterior: anteriores.length ? resumir(anteriores) : null,
  };
}
