/**
 * Evolutivo de rituales (26/09/2026, docs/05-rituales.md «Evolutivo»).
 * Foto diaria y semanal por mesa: las métricas del cierre del daily y del weekly quedan guardadas para ver
 * la evolución del mes. Lo anterior al despliegue se reconstruye desde la auditoría (origen «reconstruido»).
 */
import type { Mesa } from '@backio/shared';
import { MOTIVOS_REPROGRAMACION } from '@backio/shared';
import { type DbCtx, serviceClient, throwIf } from './db/client';
import { alcanceMesa, listMesas } from './db/mesas';
import { listUsuarios } from './db/usuarios';
import { ensureSemana } from './db/semanas';
import { fechaLocal, sumarDias } from './rituals/daily';

// ---------------------------------------------------------------- tipos
export interface TareaEvo {
  id: string; owner_agencia: string[]; estado_operativo: string; completado_at: string | null; created_at: string;
  planificacion: string | null; fecha_entrega: string | null; fecha_entrega_original: string | null; daily_fecha: string | null;
  /** Día real del pedido. En lo importado de Basecamp es la fecha de creación del to-do, no la de importación. */
  fecha_pedido?: string | null;
}
export interface EventoSeleccion { requerimiento_id: string; valor: string | null; at: string }
export interface MetricasDia {
  planificadas: number; cerradas_planificadas: number; cumplimiento_pct: number | null;
  cerradas_fuera: number; cerradas_total: number;
  nuevas_hoy: number; nuevas_no_planificadas: number; nuevas_urgentes: number;
  reprocesos_hoy: number; reprogramaciones_24h: number; bloqueos_nuevos: number; vencidas_abiertas: number;
}
export interface PersonaDia { usuario_id: string; nombre: string; planificadas: number; cerradas: number; fuera: number }
export interface MetricasSemana {
  comprometidas: number; a_tiempo_original: number; a_tiempo_vigente: number; pct_a_tiempo_original: number | null; pct_a_tiempo_vigente: number | null;
  arrastre: number; cerradas: number;
  plan_tareas: number | null; plan_cumplidas: number | null; pct_plan: number | null;
  reprocesos: number; reprogramaciones: number; reprogramaciones_equipo: number; reprogramaciones_cliente: number;
  senales_criticas: number; senales_altas: number; senales_medias: number; senales_atendidas: number;
  acuerdos: number; acuerdos_cumplidos: number; acuerdos_a_tiempo: number;
  dailies_apertura: number; dailies_cierre: number; dias_habiles: number;
}

// ---------------------------------------------------------------- utilidades de fecha (Guayaquil)
export const inicioDia = (dia: string) => new Date(`${dia}T00:00:00-05:00`).toISOString();
export const finDia = (dia: string) => inicioDia(sumarDias(dia, 1));
const diaGye = (iso: string) => new Date(new Date(iso).getTime() - 5 * 3600_000).toISOString().slice(0, 10);
const enRango = (iso: string | null | undefined, desde: string, hasta: string) => !!iso && iso >= desde && iso < hasta;
export const esHabil = (dia: string) => { const d = new Date(`${dia}T12:00:00Z`).getUTCDay(); return d !== 0 && d !== 6; };
export function diasHabiles(desde: string, hasta: string): string[] {
  const out: string[] = [];
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) if (esHabil(d)) out.push(d);
  return out;
}
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);

// ---------------------------------------------------------------- cálculo puro
/**
 * Selección del daily de `dia` según los eventos de auditoría hasta `corte`: vale el último valor de
 * daily_fecha de cada tarea antes del corte. Una tarea sin ningún evento conserva su daily_fecha actual.
 */
export function reconstruirSeleccion(dia: string, corte: string, eventos: EventoSeleccion[], tareas: Pick<TareaEvo, 'id' | 'daily_fecha'>[]): Set<string> {
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
  dia: string; seleccion: Set<string>; tareas: TareaEvo[];
  reprocesos: { requerimiento_id: string; abierto_at: string }[]; reprogramaciones: { requerimiento_id: string; created_at: string }[];
  bloqueos: number; nombres: Map<string, string>;
}): { metricas: MetricasDia; por_persona: PersonaDia[] } {
  const desde = inicioDia(p.dia), hasta = finDia(p.dia);
  const ids = new Set(p.tareas.map((t) => t.id));
  const cerradasHoy = p.tareas.filter((t) => enRango(t.completado_at, desde, hasta));
  const planificadas = p.tareas.filter((t) => p.seleccion.has(t.id));
  const cerradasPlan = planificadas.filter((t) => enRango(t.completado_at, desde, hasta));
  const fuera = cerradasHoy.filter((t) => !p.seleccion.has(t.id));
  // Nueva = pedida ese día (fecha_pedido); una importación masiva no cuenta como trabajo nuevo.
  const nuevas = p.tareas.filter((t) => t.estado_operativo !== 'cancelado' && enRango(t.created_at, desde, hasta) && (!t.fecha_pedido || t.fecha_pedido === p.dia));
  // Completada sin fecha de cierre = histórico importado: se cerró antes de cualquier periodo medido.
  const cerradaAntes = (t: TareaEvo) => (t.completado_at ? t.completado_at < hasta : t.estado_operativo === 'completado');
  const vencidas = p.tareas.filter((t) => t.estado_operativo !== 'cancelado' && t.fecha_entrega && t.fecha_entrega < p.dia && t.created_at < hasta && !cerradaAntes(t));
  const porPersona = new Map<string, PersonaDia>();
  const pp = (id: string) => { if (!porPersona.has(id)) porPersona.set(id, { usuario_id: id, nombre: p.nombres.get(id) ?? '—', planificadas: 0, cerradas: 0, fuera: 0 }); return porPersona.get(id)!; };
  for (const t of planificadas) for (const o of t.owner_agencia) { const x = pp(o); x.planificadas += 1; if (enRango(t.completado_at, desde, hasta)) x.cerradas += 1; }
  for (const t of fuera) for (const o of t.owner_agencia) pp(o).fuera += 1;
  return {
    metricas: {
      planificadas: planificadas.length, cerradas_planificadas: cerradasPlan.length, cumplimiento_pct: pct(cerradasPlan.length, planificadas.length),
      cerradas_fuera: fuera.length, cerradas_total: cerradasHoy.length,
      nuevas_hoy: nuevas.length, nuevas_no_planificadas: nuevas.filter((t) => t.planificacion === 'no_planificado').length, nuevas_urgentes: nuevas.filter((t) => t.planificacion === 'urgente').length,
      reprocesos_hoy: p.reprocesos.filter((r) => ids.has(r.requerimiento_id) && enRango(r.abierto_at, desde, hasta)).length,
      reprogramaciones_24h: p.reprogramaciones.filter((r) => ids.has(r.requerimiento_id) && enRango(r.created_at, desde, hasta)).length,
      bloqueos_nuevos: p.bloqueos, vencidas_abiertas: vencidas.length,
    },
    por_persona: [...porPersona.values()].sort((a, b) => b.planificadas - a.planificadas || a.nombre.localeCompare(b.nombre, 'es')),
  };
}

export function metricasSemana(p: {
  inicio: string; fin: string; tareas: TareaEvo[];
  reprocesos: { requerimiento_id: string; abierto_at: string }[]; reprogramaciones: { requerimiento_id: string; created_at: string; motivo: string | null }[];
  senales: { severidad: string; atendida: boolean }[]; acuerdos: { estado: string; fecha_compromiso: string; cerrado_at: string | null }[];
  planIds: string[] | null; dailies: { apertura: number; cierre: number };
}): MetricasSemana {
  const desde = inicioDia(p.inicio), hasta = finDia(p.fin);
  const ids = new Set(p.tareas.map((t) => t.id));
  // Completadas sin fecha de cierre (histórico importado) no se pueden medir: quedan fuera.
  const comprometidas = p.tareas.filter((t) => t.estado_operativo !== 'cancelado' && !(t.estado_operativo === 'completado' && !t.completado_at) && t.fecha_entrega_original && t.fecha_entrega_original >= p.inicio && t.fecha_entrega_original <= p.fin);
  const hechaAntes = (t: TareaEvo, fecha: string | null) => !!t.completado_at && !!fecha && diaGye(t.completado_at) <= fecha;
  const aOrig = comprometidas.filter((t) => hechaAntes(t, t.fecha_entrega_original)).length;
  const aVig = comprometidas.filter((t) => hechaAntes(t, t.fecha_entrega)).length;
  const porId = new Map(p.tareas.map((t) => [t.id, t]));
  const plan = p.planIds ? p.planIds.filter((id) => porId.has(id)) : null;
  const planOk = plan ? plan.filter((id) => { const t = porId.get(id)!; return !!t.completado_at && t.completado_at < hasta; }).length : null;
  const reprogs = p.reprogramaciones.filter((r) => ids.has(r.requerimiento_id) && enRango(r.created_at, desde, hasta));
  const atrib = (m: string | null) => MOTIVOS_REPROGRAMACION.find((x) => x.valor === m)?.atribuible;
  return {
    comprometidas: comprometidas.length, a_tiempo_original: aOrig, a_tiempo_vigente: aVig,
    pct_a_tiempo_original: pct(aOrig, comprometidas.length), pct_a_tiempo_vigente: pct(aVig, comprometidas.length),
    arrastre: comprometidas.filter((t) => !(t.completado_at && t.completado_at < hasta)).length,
    cerradas: p.tareas.filter((t) => enRango(t.completado_at, desde, hasta)).length,
    plan_tareas: plan ? plan.length : null, plan_cumplidas: planOk, pct_plan: plan && plan.length ? pct(planOk ?? 0, plan.length) : null,
    reprocesos: p.reprocesos.filter((r) => ids.has(r.requerimiento_id) && enRango(r.abierto_at, desde, hasta)).length,
    reprogramaciones: reprogs.length, reprogramaciones_equipo: reprogs.filter((r) => atrib(r.motivo) === 'equipo').length, reprogramaciones_cliente: reprogs.filter((r) => atrib(r.motivo) === 'cliente').length,
    senales_criticas: p.senales.filter((s) => s.severidad === 'critica').length, senales_altas: p.senales.filter((s) => s.severidad === 'alta').length,
    senales_medias: p.senales.filter((s) => s.severidad === 'media').length, senales_atendidas: p.senales.filter((s) => s.atendida).length,
    acuerdos: p.acuerdos.length, acuerdos_cumplidos: p.acuerdos.filter((a) => a.estado === 'cumplido').length,
    acuerdos_a_tiempo: p.acuerdos.filter((a) => a.estado === 'cumplido' && a.cerrado_at && diaGye(a.cerrado_at) <= a.fecha_compromiso).length,
    dailies_apertura: p.dailies.apertura, dailies_cierre: p.dailies.cierre, dias_habiles: diasHabiles(p.inicio, p.fin).length,
  };
}

// ---------------------------------------------------------------- carga por mesa
interface DatosMesa {
  mesa: Mesa; tareas: TareaEvo[]; reprocesos: { requerimiento_id: string; abierto_at: string }[];
  reprogramaciones: { requerimiento_id: string; created_at: string; motivo: string | null }[];
  eventos: EventoSeleccion[]; bloqueos: { requerimiento_id: string; at: string }[];
  publicaciones: { tipo: 'apertura' | 'cierre'; at: string; message_id: number | null }[];
  nombres: Map<string, string>;
}

async function paginar<T>(q: (a: number, b: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) { const { data, error } = await q(from, from + 999); throwIf(error as never); const f = (data ?? []) as T[]; out.push(...f); if (f.length < 1000) break; }
  return out;
}

export async function cargarMesa(ctx: DbCtx, mesa: Mesa, desdeIso: string): Promise<DatosMesa> {
  const db = serviceClient(); const T = ctx.tenantId;
  const alc = await alcanceMesa(ctx, mesa.id);
  const partes = [...(alc.clienteIds.length ? [`cliente_id.in.(${alc.clienteIds.join(',')})`] : []), ...(alc.proyectoIds.length ? [`proyecto_id.in.(${alc.proyectoIds.join(',')})`] : [])];
  const tareas = partes.length ? await paginar<TareaEvo>((a, b) => db.from('requerimientos').select('id, owner_agencia, estado_operativo, completado_at, created_at, planificacion, fecha_entrega, fecha_entrega_original, daily_fecha, fecha_pedido').eq('tenant_id', T).is('deleted_at', null).or(partes.join(',')).order('id').range(a, b)) : [];
  const ids = new Set(tareas.map((t) => t.id));
  const [rp, rg, ev, bl, pub, usuarios] = await Promise.all([
    paginar<{ requerimiento_id: string; abierto_at: string }>((a, b) => db.from('reprocesos').select('requerimiento_id, abierto_at').eq('tenant_id', T).gte('abierto_at', desdeIso).order('abierto_at').range(a, b)),
    paginar<{ requerimiento_id: string; created_at: string; motivo: string | null }>((a, b) => db.from('reprogramaciones').select('requerimiento_id, created_at, motivo').eq('tenant_id', T).gte('created_at', desdeIso).order('created_at').range(a, b)),
    paginar<{ entidad_id: string; created_at: string; detalle: { daily_fecha: string | null } }>((a, b) => db.from('audit_log').select('entidad_id, created_at, detalle').eq('tenant_id', T).eq('entidad', 'requerimiento').in('accion', ['actualizar', 'reprogramar']).not('detalle->daily_fecha', 'is', null).gte('created_at', desdeIso).order('created_at').range(a, b)),
    paginar<{ entidad_id: string; created_at: string }>((a, b) => db.from('audit_log').select('entidad_id, created_at').eq('tenant_id', T).eq('entidad', 'requerimiento').eq('detalle->>estado_operativo', 'bloqueado').gte('created_at', desdeIso).order('created_at').range(a, b)),
    paginar<{ accion: string; created_at: string; detalle: { message_id?: number } }>((a, b) => db.from('audit_log').select('accion, created_at, detalle').eq('tenant_id', T).eq('entidad_id', mesa.id).in('accion', ['publicar_daily_apertura', 'publicar_daily_cierre']).gte('created_at', desdeIso).order('created_at').range(a, b)),
    listUsuarios(ctx),
  ]);
  return {
    mesa, tareas,
    reprocesos: rp.filter((r) => ids.has(r.requerimiento_id)), reprogramaciones: rg.filter((r) => ids.has(r.requerimiento_id)),
    eventos: ev.filter((e) => ids.has(e.entidad_id)).map((e) => ({ requerimiento_id: e.entidad_id, valor: e.detalle?.daily_fecha ?? null, at: e.created_at })),
    bloqueos: bl.filter((e) => ids.has(e.entidad_id)).map((e) => ({ requerimiento_id: e.entidad_id, at: e.created_at })),
    publicaciones: pub.map((x) => ({ tipo: x.accion === 'publicar_daily_cierre' ? 'cierre' : 'apertura', at: x.created_at, message_id: x.detalle?.message_id ?? null })),
    nombres: new Map(usuarios.map((u) => [u.id, u.nombre])),
  };
}

/** Foto de un día a partir de los datos de la mesa. `reconstruir` usa la auditoría; si no, la selección actual. */
export function fotoDeDia(d: DatosMesa, dia: string, reconstruir: boolean) {
  const desde = inicioDia(dia), hasta = finDia(dia);
  const pubs = d.publicaciones.filter((x) => enRango(x.at, desde, hasta));
  const cierre = [...pubs].reverse().find((x) => x.tipo === 'cierre') ?? null;
  // Corte: la hora del cierre publicado, o el fin del día.
  const corte = cierre?.at ?? hasta;
  const seleccion = reconstruir ? reconstruirSeleccion(dia, corte, d.eventos, d.tareas) : new Set(d.tareas.filter((t) => t.daily_fecha === dia).map((t) => t.id));
  const bloqueos = new Set(d.bloqueos.filter((b) => enRango(b.at, desde, hasta)).map((b) => b.requerimiento_id)).size;
  const { metricas, por_persona } = metricasDia({ dia, seleccion, tareas: d.tareas, reprocesos: d.reprocesos, reprogramaciones: d.reprogramaciones, bloqueos, nombres: d.nombres });
  return { metricas, por_persona, seleccion: [...seleccion], publicado: !!cierre, apertura_publicada: pubs.some((x) => x.tipo === 'apertura'), message_id: cierre?.message_id ?? null };
}

async function guardarDia(ctx: DbCtx, mesaId: string, dia: string, f: ReturnType<typeof fotoDeDia>, origen: 'cierre' | 'cron' | 'reconstruido') {
  const db = serviceClient();
  const fila = { tenant_id: ctx.tenantId, mesa_id: mesaId, fecha: dia, metricas: f.metricas, seleccion: f.seleccion, por_persona: f.por_persona, publicado: f.publicado, apertura_publicada: f.apertura_publicada, message_id: f.message_id };
  const { data: ex } = await db.from('daily_snapshots').select('id, origen').eq('tenant_id', ctx.tenantId).eq('mesa_id', mesaId).eq('fecha', dia).maybeSingle();
  const e = ex as { id: string; origen: string } | null;
  // Una foto tomada en vivo (cierre/cron) no se reemplaza por una reconstruida.
  if (e && origen === 'reconstruido' && e.origen !== 'reconstruido') return;
  const { error } = e ? await db.from('daily_snapshots').update({ ...fila, origen: f.publicado && origen !== 'reconstruido' ? 'cierre' : origen }).eq('id', e.id) : await db.from('daily_snapshots').insert({ ...fila, origen: f.publicado && origen !== 'reconstruido' ? 'cierre' : origen });
  throwIf(error);
}

/** Foto del día (cierre publicado o cron de las 19:30). */
export async function fotoDaily(ctx: DbCtx, mesa: Mesa, dia = fechaLocal(), origen: 'cierre' | 'cron' = 'cron'): Promise<MetricasDia> {
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

export async function calcularSemana(ctx: DbCtx, d: DatosMesa, inicio: string, fin: string): Promise<{ semana_id: string; metricas: MetricasSemana }> {
  const db = serviceClient();
  const semana = await ensureSemana(ctx, inicio);
  const ids = new Set(d.tareas.map((t) => t.id));
  const alc = await alcanceMesa(ctx, d.mesa.id);
  const clientes = new Set(alc.clienteIds);
  const [{ data: sen }, { data: acu }, { data: acta }] = await Promise.all([
    db.from('senales').select('severidad, atendida, entidad_tipo, entidad_id').eq('tenant_id', ctx.tenantId).eq('semana_id', semana.id),
    db.from('acuerdos').select('estado, fecha_compromiso, cerrado_at').eq('tenant_id', ctx.tenantId).eq('semana_id', semana.id),
    db.from('actas').select('contenido').eq('tenant_id', ctx.tenantId).eq('semana_id', semana.id).eq('mesa_id', d.mesa.id).eq('tipo', 'plan_operativo').order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const senales = ((sen ?? []) as { severidad: string; atendida: boolean; entidad_tipo: string; entidad_id: string }[]).filter((s) => (s.entidad_tipo === 'requerimiento' && ids.has(s.entidad_id)) || (s.entidad_tipo === 'cliente' && clientes.has(s.entidad_id)));
  const planIds = acta ? (((acta as { contenido: { prioridades?: { id: string }[] } }).contenido?.prioridades ?? []).map((x) => x.id)) : null;
  const pubs = d.publicaciones.filter((x) => enRango(x.at, inicioDia(inicio), finDia(fin)));
  const diasCon = (tipo: 'apertura' | 'cierre') => new Set(pubs.filter((x) => x.tipo === tipo).map((x) => diaGye(x.at))).size;
  return {
    semana_id: semana.id,
    metricas: metricasSemana({ inicio, fin, tareas: d.tareas, reprocesos: d.reprocesos, reprogramaciones: d.reprogramaciones, senales, acuerdos: (acu ?? []) as { estado: string; fecha_compromiso: string; cerrado_at: string | null }[], planIds, dailies: { apertura: diasCon('apertura'), cierre: diasCon('cierre') } }),
  };
}

async function guardarSemana(ctx: DbCtx, mesaId: string, inicio: string, fin: string, s: { semana_id: string; metricas: MetricasSemana }, origen: 'cron' | 'reconstruido') {
  const db = serviceClient();
  const { data: ex } = await db.from('weekly_snapshots').select('id, origen').eq('tenant_id', ctx.tenantId).eq('mesa_id', mesaId).eq('semana_id', s.semana_id).maybeSingle();
  const e = ex as { id: string; origen: string } | null;
  if (e && origen === 'reconstruido' && e.origen !== 'reconstruido') return;
  const fila = { tenant_id: ctx.tenantId, mesa_id: mesaId, semana_id: s.semana_id, fecha_inicio: inicio, fecha_fin: fin, metricas: s.metricas, origen };
  const { error } = e ? await db.from('weekly_snapshots').update(fila).eq('id', e.id) : await db.from('weekly_snapshots').insert(fila);
  throwIf(error);
}

/** Foto de la semana que cierra (domingo) para cada mesa activa. */
export async function fotoWeekly(ctx: DbCtx, dia = fechaLocal()): Promise<number> {
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
  const ayer = sumarDias(fechaLocal(), -1);
  let dias = 0, semanas = 0;
  for (const mesa of (await listMesas(ctx)).filter((m) => m.activa)) {
    const d = await cargarMesa(ctx, mesa, inicioDia(sumarDias(desde, -7)));
    for (const dia of diasHabiles(desde, ayer)) { await guardarDia(ctx, mesa.id, dia, fotoDeDia(d, dia, true), 'reconstruido'); dias += 1; }
    for (let s = semanaDe(desde); s.fin <= ayer; s = semanaDe(sumarDias(s.fin, 1))) {
      await guardarSemana(ctx, mesa.id, s.inicio, s.fin, await calcularSemana(ctx, d, s.inicio, s.fin), 'reconstruido'); semanas += 1;
    }
  }
  return { dias, semanas };
}

// ---------------------------------------------------------------- lectura para la pantalla
export interface EvolutivoMes {
  mesa: { id: string; nombre: string }; mes: string;
  dias: { fecha: string; metricas: MetricasDia; por_persona: PersonaDia[]; origen: string; publicado: boolean; apertura_publicada: boolean; en_vivo?: boolean }[];
  semanas: { fecha_inicio: string; fecha_fin: string; metricas: MetricasSemana; origen: string; en_vivo?: boolean }[];
  resumen: ResumenMes; resumen_anterior: ResumenMes | null;
}
export interface ResumenMes { dias: number; dias_con_cierre: number; planificadas: number; cerradas_planificadas: number; cumplimiento_pct: number | null; cerradas_fuera: number; cerradas_total: number; fuera_de_plan: number; reprocesos: number; reprogramaciones: number; vencidas_promedio: number | null }

export function resumir(dias: { metricas: MetricasDia; publicado: boolean }[]): ResumenMes {
  const s = (k: keyof MetricasDia) => dias.reduce((acc, d) => acc + (Number(d.metricas[k]) || 0), 0);
  const plan = s('planificadas'), ok = s('cerradas_planificadas');
  return {
    dias: dias.length, dias_con_cierre: dias.filter((d) => d.publicado).length, planificadas: plan, cerradas_planificadas: ok, cumplimiento_pct: pct(ok, plan),
    cerradas_fuera: s('cerradas_fuera'), cerradas_total: s('cerradas_total'), fuera_de_plan: s('nuevas_no_planificadas') + s('nuevas_urgentes'),
    reprocesos: s('reprocesos_hoy'), reprogramaciones: s('reprogramaciones_24h'),
    vencidas_promedio: dias.length ? Math.round((s('vencidas_abiertas') / dias.length) * 10) / 10 : null,
  };
}

export async function evolutivoMes(ctx: DbCtx, mesa: Mesa, mes: string): Promise<EvolutivoMes> {
  const db = serviceClient();
  const ini = `${mes}-01`;
  const finMes = sumarDias(`${new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 1)).toISOString().slice(0, 10)}`, -1);
  const antIni = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 2, 1)).toISOString().slice(0, 10);
  const [{ data: ds, error: e1 }, { data: ws, error: e2 }] = await Promise.all([
    db.from('daily_snapshots').select('fecha, metricas, por_persona, origen, publicado, apertura_publicada').eq('tenant_id', ctx.tenantId).eq('mesa_id', mesa.id).gte('fecha', antIni).lte('fecha', finMes).order('fecha'),
    db.from('weekly_snapshots').select('fecha_inicio, fecha_fin, metricas, origen').eq('tenant_id', ctx.tenantId).eq('mesa_id', mesa.id).lte('fecha_inicio', finMes).gte('fecha_fin', ini).order('fecha_inicio'),
  ]);
  throwIf(e1); throwIf(e2);
  const todos = (ds ?? []) as EvolutivoMes['dias'];
  const dias = todos.filter((x) => x.fecha >= ini);
  const semanas = (ws ?? []) as EvolutivoMes['semanas'];
  // Hoy y la semana en curso: en vivo (aún no hay foto).
  const hoy = fechaLocal();
  if (hoy >= ini && hoy <= finMes) {
    const d = await cargarMesa(ctx, mesa, inicioDia(sumarDias(semanaDe(hoy).inicio, -7)));
    if (esHabil(hoy) && !dias.some((x) => x.fecha === hoy)) { const f = fotoDeDia(d, hoy, false); dias.push({ fecha: hoy, metricas: f.metricas, por_persona: f.por_persona, origen: 'en_vivo', publicado: f.publicado, apertura_publicada: f.apertura_publicada, en_vivo: true }); }
    const s = semanaDe(hoy);
    if (!semanas.some((x) => x.fecha_inicio === s.inicio)) { const c = await calcularSemana(ctx, d, s.inicio, s.fin); semanas.push({ fecha_inicio: s.inicio, fecha_fin: s.fin, metricas: c.metricas, origen: 'en_vivo', en_vivo: true }); }
  }
  const anteriores = todos.filter((x) => x.fecha < ini);
  return { mesa: { id: mesa.id, nombre: mesa.nombre }, mes, dias, semanas, resumen: resumir(dias), resumen_anterior: anteriores.length ? resumir(anteriores) : null };
}
