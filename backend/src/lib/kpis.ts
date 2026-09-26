/**
 * KPIs por persona y por equipo (25/09/2026). Especificación: docs/19-kpis.md.
 *  - Persona: tareas donde está en owner_agencia (y, en Cuentas, las de proyectos donde es la ejecutiva).
 *  - Equipo: Σ A / Σ B sobre las tareas ÚNICAS de sus integrantes (una tarea compartida cuenta una vez).
 *  - Lo guardado a mano (manual/ajustado) manda sobre lo calculado; lo calculado de meses cerrados se congela.
 */
import type { Area, KpiDefinicion, KpiMedicion, KpiValor, KpiTablero, KpiDetalleTarea, Usuario } from '@backio/shared';
import { AREAS, MOTIVOS_REPROCESO, MOTIVOS_REPROGRAMACION } from '@backio/shared';
import type { DbCtx } from './db/client';
import { listUsuarios } from './db/usuarios';
import { listDefiniciones, listMediciones, cargarDatosKpi, guardarMedicion, type DatosKpi, type ReqKpi } from './db/kpis';
import { dentroSla } from './horas_habiles';

/** Desde aquí existen clase, proactiva, primera_respuesta_at y rondas de revisión (migración 22). */
export const FEATURES_DESDE = '2026-09-25T05:00:00.000Z';
/**
 * Inicio de BackIO en producción. Las tareas comprometidas antes (fecha original anterior) son backlog heredado:
 * el 7-8/09 se cerraron en bloque cientos con meses de atraso, y medirlas castigaría al equipo por la limpieza.
 */
export const OPERACION_DESDE = '2026-09-04';
const heredada = (r: ReqKpi) => !!r.fecha_entrega_original && r.fecha_entrega_original < OPERACION_DESDE;

// ---------------------------------------------------------------- periodos (hora Guayaquil)
export function periodoMes(d = new Date()): string {
  const g = new Date(d.getTime() - 5 * 3600_000);
  return `${g.getUTCFullYear()}-${String(g.getUTCMonth() + 1).padStart(2, '0')}`;
}
export function trimestreDe(mes: string): string {
  const [y, m] = mes.split('-').map(Number);
  return `${y}-T${Math.ceil((m ?? 1) / 3)}`;
}
/** Rango [desde, hasta) en ISO UTC de un periodo '2026-09' o '2026-T3', con días en hora Guayaquil. */
export function rangoPeriodo(periodo: string): { desde: string; hasta: string } {
  const t = /^(\d{4})-T([1-4])$/.exec(periodo);
  const [y, m1, meses] = t ? [Number(t[1]), (Number(t[2]) - 1) * 3 + 1, 3] : [Number(periodo.slice(0, 4)), Number(periodo.slice(5, 7)), 1];
  const desde = new Date(Date.UTC(y, m1 - 1, 1, 5));
  const hasta = new Date(Date.UTC(y, m1 - 1 + meses, 1, 5));
  return { desde: desde.toISOString(), hasta: hasta.toISOString() };
}
export function periodosAnteriores(periodo: string, n: number): string[] {
  const out: string[] = [];
  const t = /^(\d{4})-T([1-4])$/.exec(periodo);
  let y = Number(periodo.slice(0, 4)); let k = t ? Number(t[2]) : Number(periodo.slice(5, 7));
  for (let i = 0; i < n; i++) {
    out.unshift(t ? `${y}-T${k}` : `${y}-${String(k).padStart(2, '0')}`);
    k -= 1; if (k < 1) { k = t ? 4 : 12; y -= 1; }
  }
  return out;
}
export const periodoDeKpi = (def: Pick<KpiDefinicion, 'periodicidad'>, mes: string) => (def.periodicidad === 'trimestral' ? trimestreDe(mes) : mes);

// ---------------------------------------------------------------- cálculo puro
const diaGye = (iso: string) => new Date(new Date(iso).getTime() - 5 * 3600_000).toISOString().slice(0, 10);
const enRango = (iso: string | null, r: { desde: string; hasta: string }) => !!iso && iso >= r.desde && iso < r.hasta;

export interface ItemKpi { req: ReqKpi; a: boolean; miembros: string[] }
export interface CalculoResultado { items: ItemKpi[]; estimado: boolean; b_fijo: number | null; sin_dato: boolean }

function miembros(r: ReqKpi, d: DatosKpi, incluirEjecutiva: boolean): string[] {
  const s = new Set(r.owner_agencia ?? []);
  if (incluirEjecutiva && r.proyecto_id) { const e = d.ejecutivaProyecto.get(r.proyecto_id); if (e) s.add(e); }
  return [...s];
}

/** Retrabajo atribuible al área: atribuible explícito, o inferido del motivo en reprocesos anteriores a la migración. */
function esRetrabajoDelArea(rp: DatosKpi['reprocesos'][number], area: Area): boolean {
  const resp = MOTIVOS_REPROCESO.find((m) => m.valor === rp.motivo)?.responsable;
  const atribuible = rp.atribuible ?? (resp === 'cliente' ? 'cliente' : resp ? 'equipo' : null);
  if (atribuible !== 'equipo') return false;
  if (rp.area_responsable) return rp.area_responsable === area;
  // Sin área explícita: los errores de ejecución/texto/dirección de arte cuentan al área de quien hizo la tarea;
  // el brief incompleto es de Cuentas.
  if (resp === 'ejecutiva') return area === 'cuentas';
  return area !== 'cuentas';
}

export function calcular(def: KpiDefinicion, d: DatosKpi, rango: { desde: string; hasta: string }): CalculoResultado {
  // Los que dependen de datos nuevos (clase, proactiva, Respondido) solo miden meses completos desde que existen:
  // un mes a medias saldría «no cumple» sin que nadie haya podido marcar nada.
  const antesDeFeatures = rango.desde < FEATURES_DESDE;
  const completadas = d.completadas.filter((r) => enRango(r.completado_at, rango) && !heredada(r));
  const repPorReq = new Map<string, DatosKpi['reprocesos']>();
  for (const rp of d.reprocesos) repPorReq.set(rp.requerimiento_id, [...(repPorReq.get(rp.requerimiento_id) ?? []), rp]);
  const rgPorReq = new Map<string, DatosKpi['reprogramaciones']>();
  for (const rg of d.reprogramaciones) rgPorReq.set(rg.requerimiento_id, [...(rgPorReq.get(rg.requerimiento_id) ?? []), rg]);
  const cuentas = def.area === 'cuentas';
  const item = (r: ReqKpi, a: boolean): ItemKpi => ({ req: r, a, miembros: miembros(r, d, cuentas) });
  const vacio = (sin_dato = true): CalculoResultado => ({ items: [], estimado: false, b_fijo: null, sin_dato });

  switch (def.calculo) {
    case 'a_tiempo':
      return { estimado: false, b_fijo: null, sin_dato: false, items: completadas.filter((r) => r.fecha_entrega_original || r.fecha_entrega).map((r) => {
        const entregado = diaGye(r.completado_at!);
        const original = !!r.fecha_entrega_original && entregado <= r.fecha_entrega_original;
        // Excluye dependencias externas: si todas las reprogramaciones fueron del cliente o neutras, vale la fecha vigente.
        const reprogs = rgPorReq.get(r.id) ?? [];
        const soloExternas = reprogs.length > 0 && reprogs.every((g) => MOTIVOS_REPROGRAMACION.find((m) => m.valor === g.motivo)?.atribuible !== 'equipo' && g.motivo !== null);
        const vigente = !!r.fecha_entrega && entregado <= r.fecha_entrega;
        return item(r, original || (soloExternas && vigente));
      }) };
    case 'retrabajo':
      return { estimado: false, b_fijo: null, sin_dato: false, items: completadas.map((r) => item(r, (repPorReq.get(r.id) ?? []).some((rp) => esRetrabajoDelArea(rp, def.area)))) };
    case 'levantamiento':
      return { estimado: false, b_fijo: null, sin_dato: false, items: completadas.map((r) => item(r, !(repPorReq.get(r.id) ?? []).some((rp) => rp.motivo === 'brief_incompleto' || rp.motivo === 'levantamiento_incompleto'))) };
    case 'aprobacion_primera': {
      const aprob = d.eventos.filter((e) => e.estado_a === 'aprobado' && enRango(e.created_at, rango));
      if (aprob.length) {
        const ultimo = new Map<string, number>();
        for (const e of aprob) ultimo.set(e.requerimiento_id, e.ronda);
        const porId = new Map(d.decididas.map((r) => [r.id, r]));
        return { estimado: false, b_fijo: null, sin_dato: false, items: [...ultimo.entries()].filter(([id]) => porId.has(id)).map(([id, ronda]) => item(porId.get(id)!, ronda === 1)) };
      }
      // Antes de las rondas: proxy = completadas sin reproceso pedido por el cliente.
      if (!completadas.length) return vacio();
      return { estimado: true, b_fijo: null, sin_dato: false, items: completadas.map((r) => item(r, !(repPorReq.get(r.id) ?? []).some((rp) => rp.origen === 'cliente'))) };
    }
    case 'propuestas_aprobadas': {
      if (antesDeFeatures) return vacio();
      const decision = new Map<string, string>();
      for (const e of d.eventos) if (enRango(e.created_at, rango)) decision.set(e.requerimiento_id, e.estado_a);
      return { estimado: false, b_fijo: null, sin_dato: false, items: d.decididas.filter((r) => r.clase === 'propuesta' && decision.has(r.id)).map((r) => item(r, decision.get(r.id) === 'aprobado')) };
    }
    case 'sla_respuesta': {
      if (antesDeFeatures) return vacio();
      const creadas = d.creadas.filter((r) => enRango(r.created_at, rango) && r.created_at >= FEATURES_DESDE);
      return { estimado: false, b_fijo: null, sin_dato: false, items: creadas.map((r) => item(r, dentroSla(r.prioridad, r.created_at, r.primera_respuesta_at) === true)) };
    }
    case 'sla_incidencia':
      if (antesDeFeatures) return vacio();
      return { estimado: false, b_fijo: null, sin_dato: false, items: completadas.filter((r) => r.clase === 'incidencia').map((r) => item(r, dentroSla(r.prioridad, r.created_at, r.completado_at) === true)) };
    case 'proactividad':
      if (antesDeFeatures) return vacio();
      return { estimado: false, b_fijo: def.denominador_fijo ?? 1, sin_dato: false, items: d.creadas.filter((r) => r.proactiva && enRango(r.created_at, rango)).map((r) => item(r, true)) };
    case 'manual':
      return vacio();
  }
}

export function estadoDe(resultado: number | null, meta: number, operador: '>=' | '<='): KpiValor['estado'] {
  if (resultado === null) return 'sin_dato';
  const eps = 1e-9;
  return (operador === '>=' ? resultado + eps >= meta : resultado - eps <= meta) ? 'cumple' : 'no_cumple';
}

function valor(def: KpiDefinicion, a: number | null, b: number | null, origen: KpiValor['origen'], estimado: boolean, medicion: KpiMedicion | null): KpiValor {
  const meta = medicion?.meta_individual ?? def.meta;
  const resultado = a !== null && b !== null && b > 0 ? a / b : null;
  return { dato_a: a, dato_b: b, resultado, meta, estado: estadoDe(resultado, meta, def.operador), origen: resultado === null && origen === 'auto' ? 'sin_dato' : origen, estimado, medicion };
}

/** Resuelve persona y equipo de un KPI en un periodo, mezclando cálculo y mediciones guardadas. */
export function resolverKpi(def: KpiDefinicion, periodo: string, d: DatosKpi | null, integrantes: Pick<Usuario, 'id'>[], mediciones: KpiMedicion[], cerrado: boolean): { equipo: KpiValor; personas: Map<string, KpiValor>; items: ItemKpi[] } {
  const med = (usuarioId: string | null) => mediciones.find((m) => m.kpi_id === def.id && m.periodo === periodo && m.usuario_id === usuarioId) ?? null;
  const calc = def.calculo !== 'manual' && d ? calcular(def, d, rangoPeriodo(periodo)) : null;
  const personas = new Map<string, KpiValor>();
  let sumA = 0, sumB = 0, conDato = 0, ajustada = false;
  for (const u of integrantes) {
    const m = med(u.id);
    let v: KpiValor;
    if (m && m.origen !== 'auto') { v = valor(def, m.dato_a, m.dato_b, m.origen, false, m); ajustada = true; }
    else if (m && cerrado) v = valor(def, m.dato_a, m.dato_b, 'auto', false, m);
    else if (calc && !calc.sin_dato) {
      const mios = calc.items.filter((i) => i.miembros.includes(u.id));
      const b = calc.b_fijo ?? mios.length;
      v = valor(def, mios.filter((i) => i.a).length, b, 'auto', calc.estimado, m);
    } else v = valor(def, null, null, def.calculo === 'manual' ? 'sin_dato' : 'auto', false, m);
    personas.set(u.id, v);
    if (v.dato_a !== null && v.dato_b !== null) { sumA += v.dato_a; sumB += v.dato_b; conDato += 1; }
  }
  const mEq = med(null);
  let equipo: KpiValor;
  if (mEq && mEq.origen !== 'auto') equipo = valor(def, mEq.dato_a, mEq.dato_b, mEq.origen, false, mEq);
  else if (mEq && cerrado) equipo = valor(def, mEq.dato_a, mEq.dato_b, 'auto', false, mEq);
  else if (calc && !calc.sin_dato && !ajustada) {
    const ids = new Set(integrantes.map((u) => u.id));
    const delEquipo = calc.items.filter((i) => i.miembros.some((x) => ids.has(x)));
    const b = calc.b_fijo !== null ? calc.b_fijo * integrantes.length : delEquipo.length;
    equipo = valor(def, delEquipo.filter((i) => i.a).length, b, 'auto', calc.estimado, mEq);
  } else if (conDato) {
    // Manuales o con personas ajustadas: el equipo agrega Σ A / Σ B de sus integrantes.
    equipo = valor(def, sumA, sumB, ajustada ? 'ajustado' : def.calculo === 'manual' ? 'manual' : 'auto', calc?.estimado ?? false, mEq);
  } else equipo = valor(def, null, null, 'sin_dato', false, mEq);
  return { equipo, personas, items: calc?.items ?? [] };
}

// ---------------------------------------------------------------- orquestación
export async function tableroKpis(ctx: DbCtx, mes: string): Promise<KpiTablero> {
  const [defs, usuarios] = await Promise.all([listDefiniciones(ctx, true), listUsuarios(ctx)]);
  const meses = periodosAnteriores(mes, 6);
  const trimestres = periodosAnteriores(trimestreDe(mes), 4);
  const rango = { desde: rangoPeriodo(meses[0]!).desde, hasta: rangoPeriodo(mes).hasta };
  const hayAuto = defs.some((x) => x.calculo !== 'manual');
  const [d, mediciones] = await Promise.all([hayAuto ? cargarDatosKpi(ctx, rango.desde, rango.hasta) : Promise.resolve(null), listMediciones(ctx, [...meses, ...trimestres])]);
  const actual = periodoMes();
  const cerrado = (p: string) => rangoPeriodo(p).hasta <= rangoPeriodo(actual).desde;
  const resumen = { cumple: 0, no_cumple: 0, sin_dato: 0 };
  const areas: KpiTablero['areas'] = [];
  for (const area of AREAS) {
    const integrantes = usuarios.filter((u) => u.area === area);
    const kpis: KpiTablero['areas'][number]['kpis'] = [];
    for (const def of defs.filter((x) => x.area === area)) {
      const periodo = periodoDeKpi(def, mes);
      const serieP = def.periodicidad === 'trimestral' ? trimestres : meses;
      const r = resolverKpi(def, periodo, d, integrantes, mediciones, cerrado(periodo));
      resumen[r.equipo.estado] += 1;
      kpis.push({
        definicion: def, equipo: r.equipo,
        personas: integrantes.map((u) => ({ usuario_id: u.id, nombre: u.nombre, avatar_url: u.avatar_url, valor: r.personas.get(u.id)! })),
        serie: serieP.map((p) => { const v = p === periodo ? r.equipo : resolverKpi(def, p, d, integrantes, mediciones, cerrado(p)).equipo; return { periodo: p, resultado: v.resultado, estado: v.estado }; }),
      });
    }
    areas.push({ area, integrantes: integrantes.length, kpis });
  }
  return { periodo: mes, en_curso: !cerrado(mes), areas, resumen, sin_area: usuarios.filter((u) => !u.area && !['admin', 'gerencia'].includes(u.rol)).map((u) => ({ usuario_id: u.id, nombre: u.nombre })) };
}

/** Tareas que componen A y B de un KPI (equipo o una persona). */
export async function detalleKpi(ctx: DbCtx, codigo: string, mes: string, usuarioId?: string): Promise<{ definicion: KpiDefinicion; periodo: string; tareas: KpiDetalleTarea[] }> {
  const [defs, usuarios] = await Promise.all([listDefiniciones(ctx), listUsuarios(ctx)]);
  const def = defs.find((x) => x.codigo === codigo);
  if (!def) throw new Error('KPI no encontrado');
  const periodo = periodoDeKpi(def, mes);
  if (def.calculo === 'manual') return { definicion: def, periodo, tareas: [] };
  const r = rangoPeriodo(periodo);
  const d = await cargarDatosKpi(ctx, r.desde, r.hasta);
  const calc = calcular(def, d, r);
  const ids = new Set(usuarioId ? [usuarioId] : usuarios.filter((u) => u.area === def.area).map((u) => u.id));
  const nombre = (id: string) => usuarios.find((u) => u.id === id)?.nombre ?? '';
  const nota = (i: ItemKpi): string | null => {
    if (def.calculo === 'sla_respuesta') return i.req.primera_respuesta_at ? null : 'sin «Respondido»';
    return null;
  };
  return {
    definicion: def, periodo,
    tareas: calc.items.filter((i) => i.miembros.some((x) => ids.has(x))).map((i) => ({
      id: i.req.id, titulo: i.req.titulo_interno, cliente: d.clientes.get(i.req.cliente_id) ?? '', responsables: i.miembros.map(nombre).filter(Boolean).join(', '),
      fecha: i.req.completado_at ?? i.req.created_at, basecamp_url: i.req.basecamp_url, cuenta_en_a: i.a, nota: nota(i),
    })).sort((a, b) => Number(a.cuenta_en_a) - Number(b.cuenta_en_a)),
  };
}

/** Día 1: guarda como `auto` los valores calculados del periodo cerrado (no pisa lo manual/ajustado). */
export async function congelarPeriodo(ctx: DbCtx, periodo: string): Promise<number> {
  const [defs, usuarios] = await Promise.all([listDefiniciones(ctx, true), listUsuarios(ctx)]);
  const auto = defs.filter((x) => x.calculo !== 'manual' && (x.periodicidad === 'trimestral') === periodo.includes('-T'));
  if (!auto.length) return 0;
  const r = rangoPeriodo(periodo);
  const [d, mediciones] = await Promise.all([cargarDatosKpi(ctx, r.desde, r.hasta), listMediciones(ctx, [periodo])]);
  let n = 0;
  for (const def of auto) {
    const integrantes = usuarios.filter((u) => u.area === def.area);
    const res = resolverKpi(def, periodo, d, integrantes, mediciones, false);
    const filas: [string | null, KpiValor][] = [[null, res.equipo], ...[...res.personas.entries()]];
    for (const [usuarioId, v] of filas) {
      if (v.origen !== 'auto' || v.dato_b === null) continue;
      const previa = mediciones.find((m) => m.kpi_id === def.id && m.periodo === periodo && m.usuario_id === usuarioId);
      if (previa && previa.origen !== 'auto') continue;
      await guardarMedicion(ctx, { kpi_id: def.id, periodo, usuario_id: usuarioId, dato_a: v.dato_a, dato_b: v.dato_b, origen: 'auto' });
      n += 1;
    }
  }
  return n;
}

/** Fila CSV compatible con Plantilla_KPIs.xlsx (hoja Seguimiento KPI). */
export async function exportarCsv(ctx: DbCtx, meses: string[]): Promise<string> {
  const usuarios = await listUsuarios(ctx);
  const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const filas: unknown[][] = [['Periodo', 'ID KPI', 'Equipo', 'Persona', 'Indicador', 'Periodicidad', 'Dato A', 'Dato B', 'Resultado', 'Meta', 'Operador', 'Cumplimiento', 'Origen', 'Causa', 'Atribuible', 'Evidencia', 'Plan de mejora', 'Responsable', 'Fecha seguimiento']];
  const nombre = (id: string | null | undefined) => usuarios.find((u) => u.id === id)?.nombre ?? '';
  const vistos = new Set<string>();
  for (const mes of meses) {
    const t = await tableroKpis(ctx, mes);
    for (const a of t.areas) for (const k of a.kpis) {
      const periodo = periodoDeKpi(k.definicion, mes);
      if (vistos.has(`${k.definicion.codigo}|${periodo}`)) continue; // trimestrales: una vez por trimestre
      vistos.add(`${k.definicion.codigo}|${periodo}`);
      const fila = (persona: string, v: KpiValor) => [periodo, k.definicion.codigo, a.area, persona, k.definicion.indicador, k.definicion.periodicidad, v.dato_a, v.dato_b, v.resultado === null ? '' : v.resultado.toFixed(4), v.meta, k.definicion.operador, v.estado === 'cumple' ? 'Cumple' : v.estado === 'no_cumple' ? 'No cumple' : '', v.origen, v.medicion?.causa, v.medicion?.atribuible, v.medicion?.evidencia_url, v.medicion?.plan_mejora, nombre(v.medicion?.responsable_id), v.medicion?.fecha_seguimiento];
      filas.push(fila('(equipo)', k.equipo));
      for (const p of k.personas) filas.push(fila(p.nombre, p.valor));
    }
  }
  return filas.map((f) => f.map(esc).join(',')).join('\n');
}
