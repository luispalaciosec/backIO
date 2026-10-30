/**
 * Carga de la semana y tareas en riesgo (docs/05, «Riesgo de la semana»): cuántas horas le quedan a cada persona por lo
 * que vence hasta el domingo, contra su capacidad en los días hábiles que quedan. Si no le alcanza, las tareas que no
 * entran (ordenadas por fecha) quedan «en riesgo» y se avisa el lunes al líder de la mesa y a la ejecutiva de la cuenta.
 *
 * Las horas de cada tarea salen de lo que el equipo tarda de verdad (timesheet de Basecamp, tareas completadas en
 * las últimas 12 semanas), no de un promedio fijo: por tipo de pieza si hay datos, si no por persona, si no la mediana general.
 *
 * La capacidad se mide en la misma unidad: lo que la persona registra en una semana fuerte (percentil 75 de las últimas
 * 12 semanas con horas). Contra las 40 h declaradas nunca saltaba: el timesheet recoge ~13 h por persona y semana
 * (revisión del 30/10/2026). Sin timesheet suficiente, la del equipo; sin nada, la declarada.
 */
import type { RequerimientoMetricas, Usuario, TipoPieza } from '@backio/shared';
import { hoyLocal, medianaDe, nombrePersona, sumarDias } from '@backio/shared';
import type { DbCtx } from './db/client';
import { listBacklog } from './db/requerimientos';
import { listUsuarios } from './db/usuarios';
import { listHorasConTarea, type FilaHorasTarea } from './db/horas';
import { listTiposPieza } from './db/tipos_pieza';
import { idsClientesDePrueba, listClientes } from './db/clientes';
import { listMesas } from './db/mesas';
import { listProyectos } from './db/proyectos';
import { ensureSemana } from './db/semanas';
import { notificar } from './notificaciones';

/** Tareas completadas con horas que hacen falta para confiar en una mediana. */
export const MIN_MUESTRAS = 5;
/** Horas por tarea cuando no hay ningún dato (lo que asumía antes la señal de sobrecarga). */
export const HORAS_SIN_DATOS = 4;
/** Una tarea abierta siempre deja algo por hacer, aunque ya lleve más horas que lo estimado. */
const HORAS_MINIMAS_RESTANTES = 0.5;
/** Semanas con horas que hacen falta para usar el ritmo propio de una persona. */
export const MIN_SEMANAS_RITMO = 6;
/** Semanas de timesheet que se miran para el ritmo. */
const SEMANAS_RITMO = 12;
/** Una tarea atrasada cuenta en la carga solo si se movió en estos días (las quietas se preguntan en «Mi día»). */
export const DIAS_ATRASADA_VIVA = 7;

export type BaseEstimacion = 'tipo' | 'esfuerzo' | 'persona' | 'general' | 'fijo';
export type Estimador = (usuarioId: string, tipoPiezaId: string | null) => { horas: number; base: BaseEstimacion };

/** Horas que una persona registró en una tarea completada. */
export interface MuestraHoras {
  usuario_id: string;
  tipo_pieza_id: string | null;
  horas: number;
}

export type BaseCapacidad = 'ritmo' | 'equipo' | 'declarada';
export type Capacidades = (u: Usuario) => { horas: number; base: BaseCapacidad };

export interface TareaCarga {
  id: string;
  titulo: string;
  cliente_id: string;
  proyecto_id: string | null;
  fecha_entrega: string;
  /** Horas que le faltan a esta persona en esta tarea. */
  horas: number;
  base: BaseEstimacion;
}

export interface CargaPersona {
  usuario_id: string;
  nombre: string;
  /** Horas de una semana completa: su ritmo del timesheet, el del equipo o la declarada. */
  capacidad_semanal: number;
  capacidad_base: BaseCapacidad;
  /** Capacidad de los días hábiles que quedan de la semana (desde hoy). */
  capacidad_restante: number;
  horas: number;
  tareas: TareaCarga[];
  /** Las que no entran en la capacidad que queda, de la fecha más lejana hacia atrás. */
  en_riesgo: TareaCarga[];
  exceso: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Agrupa las filas del timesheet por persona y tarea: muestras (tareas completadas) y lo ya registrado (abiertas). */
export function agruparHoras(filas: FilaHorasTarea[]): { muestras: MuestraHoras[]; registradas: Map<string, number> } {
  const porPar = new Map<string, MuestraHoras & { completada: boolean }>();
  for (const f of filas) {
    if (!f.usuario_id || !f.requerimiento_id || !f.requerimientos) continue;
    const k = `${f.usuario_id}|${f.requerimiento_id}`;
    const x = porPar.get(k) ?? {
      usuario_id: f.usuario_id,
      tipo_pieza_id: f.requerimientos.tipo_pieza_id,
      horas: 0,
      completada: f.requerimientos.estado_operativo === 'completado',
    };
    x.horas += Number(f.horas);
    porPar.set(k, x);
  }
  const muestras: MuestraHoras[] = [];
  const registradas = new Map<string, number>();
  for (const [k, x] of porPar) {
    if (x.completada) muestras.push({ usuario_id: x.usuario_id, tipo_pieza_id: x.tipo_pieza_id, horas: x.horas });
    else registradas.set(k, x.horas);
  }
  return { muestras, registradas };
}

/**
 * Estimador de horas por persona y tipo de pieza. Orden: mediana del tipo de pieza (con datos suficientes), esfuerzo del
 * tipo × mediana general, mediana de la persona, mediana general y, sin nada, 4 h.
 */
export function crearEstimador(muestras: MuestraHoras[], tipos: Pick<TipoPieza, 'id' | 'esfuerzo'>[]): Estimador {
  const mediana = (xs: MuestraHoras[]) => (xs.length >= MIN_MUESTRAS ? medianaDe(xs.map((m) => m.horas)) : null);
  const general = mediana(muestras);
  const porTipo = new Map<string, number | null>();
  const porPersona = new Map<string, number | null>();
  return (usuarioId, tipoPiezaId) => {
    if (tipoPiezaId) {
      if (!porTipo.has(tipoPiezaId)) porTipo.set(tipoPiezaId, mediana(muestras.filter((m) => m.tipo_pieza_id === tipoPiezaId)));
      const t = porTipo.get(tipoPiezaId);
      if (t) return { horas: t, base: 'tipo' };
      const esfuerzo = tipos.find((x) => x.id === tipoPiezaId)?.esfuerzo;
      if (esfuerzo && general) return { horas: r1(esfuerzo * general), base: 'esfuerzo' };
    }
    if (!porPersona.has(usuarioId)) porPersona.set(usuarioId, mediana(muestras.filter((m) => m.usuario_id === usuarioId)));
    const p = porPersona.get(usuarioId);
    if (p) return { horas: p, base: 'persona' };
    if (general) return { horas: general, base: 'general' };
    return { horas: HORAS_SIN_DATOS, base: 'fijo' };
  };
}

const lunesDe = (dia: string) => sumarDias(dia, -((new Date(`${dia}T12:00:00Z`).getUTCDay() + 6) % 7));
/** Percentil 75: una semana fuerte, no la excepcional. */
const p75 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.75) - 1]!;

/**
 * Capacidad semanal de cada persona en horas de timesheet: el percentil 75 de lo que registró por semana en las 12
 * semanas anteriores a `inicioSemana` (solo semanas con horas, para no contar vacaciones). Con menos de 6 semanas, la
 * mediana de las del equipo; sin ninguna, la capacidad declarada.
 */
export function crearCapacidades(filas: Pick<FilaHorasTarea, 'usuario_id' | 'fecha' | 'horas'>[], inicioSemana: string): Capacidades {
  const desde = sumarDias(inicioSemana, -7 * SEMANAS_RITMO);
  const porPersona = new Map<string, Map<string, number>>();
  for (const f of filas) {
    if (!f.usuario_id || f.fecha < desde || f.fecha >= inicioSemana) continue;
    const semanas = porPersona.get(f.usuario_id) ?? new Map<string, number>();
    const l = lunesDe(f.fecha);
    semanas.set(l, (semanas.get(l) ?? 0) + Number(f.horas));
    porPersona.set(f.usuario_id, semanas);
  }
  const ritmo = new Map<string, number>();
  for (const [uid, semanas] of porPersona) {
    const xs = [...semanas.values()].filter((h) => h > 0);
    if (xs.length >= MIN_SEMANAS_RITMO) ritmo.set(uid, r1(p75(xs)));
  }
  const equipo = medianaDe([...ritmo.values()]);
  return (u) => {
    const propio = ritmo.get(u.id);
    if (propio) return { horas: propio, base: 'ritmo' };
    if (equipo) return { horas: equipo, base: 'equipo' };
    return { horas: u.capacidad_semanal, base: 'declarada' };
  };
}

/** Días hábiles (lunes a viernes) desde hoy, o desde el inicio si la semana no empezó, hasta el fin de la semana. */
export function diasHabilesRestantes(hoy: string, semana: { fecha_inicio: string; fecha_fin: string }): number {
  let n = 0;
  for (let d = hoy > semana.fecha_inicio ? hoy : semana.fecha_inicio; d <= semana.fecha_fin; d = sumarDias(d, 1)) {
    const dia = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (dia >= 1 && dia <= 5) n += 1;
  }
  return n;
}

/**
 * Lo que entra en la carga de la semana: vence hasta el domingo y no espera al cliente. Las atrasadas cuentan solo si se
 * movieron en los últimos 7 días; las quietas seguramente ya se entregaron y se preguntan en «Mi día».
 */
export function cuentaEnLaCarga(r: RequerimientoMetricas, hoy: string, finSemana: string): boolean {
  if (!r.fecha_entrega || r.fecha_entrega > finSemana) return false;
  if (r.estado_aprobacion === 'pendiente_cliente') return false;
  return r.fecha_entrega >= hoy || r.dias_sin_movimiento <= DIAS_ATRASADA_VIVA;
}

/** Carga de cada persona activa con tareas en la semana. Pura: se prueba sin base. */
export function calcularCarga(e: {
  activos: RequerimientoMetricas[];
  usuarios: Usuario[];
  semana: { fecha_inicio: string; fecha_fin: string };
  hoy: string;
  estimar: Estimador;
  capacidades: Capacidades;
  /** Horas ya registradas por persona y tarea («usuario|tarea»). */
  registradas: Map<string, number>;
}): CargaPersona[] {
  const dias = diasHabilesRestantes(e.hoy, e.semana);
  const semana = e.activos.filter((r) => cuentaEnLaCarga(r, e.hoy, e.semana.fecha_fin));
  return e.usuarios
    .filter((u) => u.activo && u.capacidad_semanal > 0)
    .map((u) => {
      const tareas = semana
        .filter((r) => r.owner_agencia.includes(u.id))
        .map((r): TareaCarga => {
          const est = e.estimar(u.id, r.tipo_pieza_id);
          const hechas = e.registradas.get(`${u.id}|${r.id}`) ?? 0;
          return {
            id: r.id,
            titulo: r.titulo_interno,
            cliente_id: r.cliente_id,
            proyecto_id: r.proyecto_id,
            fecha_entrega: r.fecha_entrega!,
            horas: r1(Math.max(est.horas - hechas, HORAS_MINIMAS_RESTANTES)),
            base: est.base,
          };
        })
        .sort((a, b) => a.fecha_entrega.localeCompare(b.fecha_entrega) || a.id.localeCompare(b.id));
      const semanal = e.capacidades(u);
      const capacidad = r1((semanal.horas * dias) / 5);
      const horas = r1(tareas.reduce((s, t) => s + t.horas, 0));
      // Se hacen en orden de fecha: lo que ya no entra en la capacidad que queda está en riesgo.
      let acumulado = 0;
      const en_riesgo = dias === 0 ? [] : tareas.filter((t) => (acumulado += t.horas) > capacidad + 0.05);
      return {
        usuario_id: u.id,
        nombre: nombrePersona(u),
        capacidad_semanal: semanal.horas,
        capacidad_base: semanal.base,
        capacidad_restante: capacidad,
        horas,
        tareas,
        en_riesgo,
        exceso: dias === 0 ? 0 : r1(Math.max(horas - capacidad, 0)),
      };
    })
    .filter((c) => c.tareas.length > 0)
    .sort((a, b) => b.exceso - a.exceso || b.horas - a.horas);
}

/** Carga de todo el equipo (sin clientes de prueba): la de una persona incluye todas sus mesas. */
export async function cargaDelEquipo(
  ctx: DbCtx,
  semana: { fecha_inicio: string; fecha_fin: string },
  hoy = hoyLocal(),
): Promise<CargaPersona[]> {
  const [activos, usuarios, horas, tipos, prueba] = await Promise.all([
    listBacklog(ctx, { solo_activos: true, hasta: semana.fecha_fin }),
    listUsuarios(ctx),
    listHorasConTarea(ctx, sumarDias(semana.fecha_inicio < hoy ? semana.fecha_inicio : hoy, -7 * SEMANAS_RITMO)),
    listTiposPieza(ctx, true),
    idsClientesDePrueba(ctx),
  ]);
  const { muestras, registradas } = agruparHoras(horas);
  return calcularCarga({
    activos: activos.filter((r) => !prueba.has(r.cliente_id)),
    usuarios,
    semana,
    hoy,
    estimar: crearEstimador(muestras, tipos),
    capacidades: crearCapacidades(horas, semana.fecha_inicio),
    registradas,
  });
}

const MAX_LINEAS = 10;
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
/** «lun 3/11». */
export const diaCorto = (iso: string) =>
  `${DIAS[new Date(`${iso}T12:00:00Z`).getUTCDay()]} ${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;

/** Texto del aviso del lunes para una persona que recibe tareas en riesgo (líder de mesa o ejecutiva). */
export function textoRiesgo(
  items: { tarea: TareaCarga; persona: CargaPersona }[],
  cliente: (id: string) => string,
): { titulo: string; cuerpo: string } {
  const lineas = items
    .slice(0, MAX_LINEAS)
    .map(
      ({ tarea: t, persona: p }) =>
        `• ${t.titulo}${cliente(t.cliente_id) ? ` (${cliente(t.cliente_id)})` : ''}: vence el ${diaCorto(t.fecha_entrega)}; ${p.nombre} tiene ~${Math.round(p.horas)} h para ${Math.round(p.capacidad_restante)} h disponibles.`,
    );
  if (items.length > MAX_LINEAS) lineas.push(`y ${items.length - MAX_LINEAS} más en el weekly.`);
  const personas = new Set(items.map((i) => i.persona.usuario_id)).size;
  return {
    titulo: `${items.length} ${items.length === 1 ? 'tarea en riesgo' : 'tareas en riesgo'} esta semana`,
    cuerpo: [
      `${personas === 1 ? 'Una persona tiene' : `${personas} personas tienen`} más trabajo estimado que horas disponibles. Conviene repartir, recortar o avisar al cliente hoy:`,
      ...lineas,
    ].join('\n'),
  };
}

/**
 * Aviso del lunes: a cada líder de mesa y ejecutiva de cuenta, las tareas en riesgo de sus clientes. La ejecutiva es la
 * del proyecto si tiene, si no la de la cuenta. Devuelve cuántas tareas hay en riesgo y a cuántas personas se avisó.
 */
export async function avisarRiesgoSemana(ctx: DbCtx, hoy = hoyLocal()): Promise<{ en_riesgo: number; avisados: number }> {
  const semana = await ensureSemana(ctx, hoy);
  const carga = await cargaDelEquipo(ctx, semana, hoy);
  const items = carga.flatMap((p) => p.en_riesgo.map((tarea) => ({ tarea, persona: p })));
  if (!items.length) return { en_riesgo: 0, avisados: 0 };
  const [clientes, mesas, proyectos] = await Promise.all([
    listClientes(ctx, { incluirInactivos: true }),
    listMesas(ctx),
    listProyectos(ctx),
  ]);
  const destino = new Map<string, typeof items>();
  for (const it of items) {
    const cl = clientes.find((c) => c.id === it.tarea.cliente_id);
    const ejecutiva = proyectos.find((p) => p.id === it.tarea.proyecto_id)?.owner_ejecutiva ?? cl?.ejecutiva_id;
    const lider = mesas.find((m) => m.id === cl?.mesa_id)?.lider_id;
    for (const uid of new Set([ejecutiva, lider].filter((x): x is string => !!x))) destino.set(uid, [...(destino.get(uid) ?? []), it]);
  }
  const nombre = (id: string) => clientes.find((c) => c.id === id)?.nombre ?? '';
  for (const [uid, suyos] of destino) {
    await notificar(ctx, { tipo: 'riesgo_semana', ...textoRiesgo(suyos, nombre), ruta: '/weekly' }, { usuarioIds: [uid] });
  }
  return { en_riesgo: items.length, avisados: destino.size };
}
