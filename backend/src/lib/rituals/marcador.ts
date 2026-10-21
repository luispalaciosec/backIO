/**
 * Marcador del weekly (decisión de Luis, 20/10/2026): meta, racha, récord del trimestre y reconocimiento de entregas a
 * tiempo, arriba del plan operativo y del acta de cierre de cada mesa. Todo sale de los datos; nada se escribe a mano y
 * nunca se nombra a quien no cumplió.
 */
import { cerradaATiempo, diaLocal, responsablesDe, sumarDias } from '@backio/shared';

/** Meta de la semana: % de tareas vigentes completadas. Igual para todas las mesas. */
export const META_SEMANAL = 80;
/** Para el reconocimiento: todas a tiempo, con al menos esta cantidad de tareas en la semana. */
export const RECONOCIMIENTO_MINIMO = 4;
/** Semanas hacia atrás que se miran para la racha (además del trimestre). */
export const SEMANAS_HISTORIAL = 16;

export interface TareaMarcador {
  fecha_entrega: string | null;
  fecha_entrega_original?: string | null;
  estado_operativo: string;
  completado_at: string | null;
  owner_agencia: string[];
  responsables_cierre?: string[] | null;
  heredada?: boolean | null;
}

export interface ResultadoSemana {
  inicio: string;
  numero: number;
  completadas: number;
  vigentes: number;
  /** Completadas, pero después del corte: no cuentan en el resultado ni pasan al arrastre. */
  tarde: number;
  pct: number | null;
}

export interface Reconocido {
  usuario_id: string;
  a_tiempo: number;
}

export interface Marcador {
  meta: number;
  /** Semana del documento. En el plan sirve para el compromiso: tareas con entrega y cuántas ya están completadas. */
  actual: ResultadoSemana;
  compromiso: number;
  ya_completadas: number;
  anterior: ResultadoSemana | null;
  racha: number;
  mejor_racha_trimestre: number;
  /** Mejor semana del trimestre antes de la actual. */
  mejor_trimestre: ResultadoSemana | null;
  record: 'supera' | 'iguala' | null;
  reconocidos: Reconocido[];
}

/** Lunes de la semana de un día (AAAA-MM-DD). */
export function lunesDe(dia: string): string {
  const dow = (new Date(`${dia}T12:00:00Z`).getUTCDay() + 6) % 7;
  return sumarDias(dia, -dow);
}

/** Número de semana ISO de un lunes. */
export function numeroIso(lunes: string): number {
  const jueves = new Date(`${sumarDias(lunes, 3)}T00:00:00Z`);
  const enero1 = Date.UTC(jueves.getUTCFullYear(), 0, 1);
  return Math.ceil(((jueves.getTime() - enero1) / 86_400_000 + 1) / 7);
}

/** Primer día del trimestre calendario de un día. */
export function inicioTrimestre(dia: string): string {
  const [y, m] = dia.split('-').map(Number) as [number, number];
  return `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);

/**
 * Resultado de una semana: completadas sobre vigentes (las canceladas no cuentan). Con `corte`, una tarea cuenta como
 * completada solo si se cerró hasta ese día. El marcador corta en el domingo de cada semana: así una semana da el mismo
 * número en su acta de cierre y como «semana pasada» en el plan siguiente, y lo que se cerró después no la mejora.
 */
export function resultadoSemana(tareas: TareaMarcador[], inicio: string, corte: string | null): ResultadoSemana {
  const fin = sumarDias(inicio, 6);
  const vigentes = tareas.filter(
    (t) => t.fecha_entrega && t.fecha_entrega >= inicio && t.fecha_entrega <= fin && t.estado_operativo !== 'cancelado',
  );
  // Una completada sin completado_at (históricas, docs/05) cuenta como completada: no se sabe cuándo, no se castiga.
  const hechas = vigentes.filter((t) => t.estado_operativo === 'completado');
  const enSemana = hechas.filter((t) => !corte || !t.completado_at || diaLocal(t.completado_at) <= corte).length;
  return {
    inicio,
    numero: numeroIso(inicio),
    completadas: enSemana,
    vigentes: vigentes.length,
    tarde: hechas.length - enSemana,
    pct: pct(enSemana, vigentes.length),
  };
}

/** Semanas consecutivas, desde la última hacia atrás, en la meta o por encima. Las semanas sin tareas no cortan ni suman. */
export function racha(semanas: ResultadoSemana[], meta = META_SEMANAL): number {
  let n = 0;
  for (const s of [...semanas].reverse()) {
    if (s.pct === null) continue;
    if (s.pct < meta) break;
    n += 1;
  }
  return n;
}

/**
 * La mejor racha que llegó al trimestre: puede haber empezado antes (así nunca es menor que la racha actual, que mira
 * más atrás). Se cuenta por semanas del historial y solo se registra al pasar por semanas del trimestre.
 */
function mejorRacha(semanas: ResultadoSemana[], desde: string, meta = META_SEMANAL): number {
  let mejor = 0,
    n = 0;
  for (const s of semanas) {
    if (s.pct === null) continue;
    n = s.pct >= meta ? n + 1 : 0;
    if (s.inicio >= desde) mejor = Math.max(mejor, n);
  }
  return mejor;
}

/**
 * Quiénes entregaron a tiempo todas sus tareas de la semana (contra la fecha original: reprogramar no cuenta como a
 * tiempo), con un mínimo de tareas. Una heredada cerrada tarde no cuenta para nadie (docs/20).
 */
export function reconocidos(tareas: TareaMarcador[], inicio: string, minimo = RECONOCIMIENTO_MINIMO): Reconocido[] {
  const fin = sumarDias(inicio, 6);
  const porPersona = new Map<string, { total: number; a_tiempo: number }>();
  for (const t of tareas) {
    if (!t.fecha_entrega || t.fecha_entrega < inicio || t.fecha_entrega > fin || t.estado_operativo === 'cancelado') continue;
    const r = cerradaATiempo(t.completado_at, t.fecha_entrega_original ?? t.fecha_entrega, !!t.heredada);
    if (r === null && t.completado_at) continue;
    for (const u of responsablesDe(t)) {
      const p = porPersona.get(u) ?? { total: 0, a_tiempo: 0 };
      p.total += 1;
      if (r === true) p.a_tiempo += 1;
      porPersona.set(u, p);
    }
  }
  return [...porPersona.entries()]
    .filter(([, p]) => p.total >= minimo && p.a_tiempo === p.total)
    .map(([usuario_id, p]) => ({ usuario_id, a_tiempo: p.a_tiempo }))
    .sort((a, b) => b.a_tiempo - a.a_tiempo);
}

/**
 * Marcador de la semana que empieza en `inicio`. `tareas` = las de la mesa con entrega desde el historial hasta el fin
 * de la semana. En el cierre (`cierre: true`) la semana actual cuenta para racha y récord; en el plan, todavía no.
 */
export function calcularMarcador(tareas: TareaMarcador[], inicio: string, opts: { cierre: boolean }): Marcador {
  const trimestre = inicioTrimestre(inicio);
  const primera = [trimestre, sumarDias(inicio, -7 * SEMANAS_HISTORIAL)].sort()[0]!;
  const pasadas: ResultadoSemana[] = [];
  for (let s = lunesDe(primera); s < inicio; s = sumarDias(s, 7)) pasadas.push(resultadoSemana(tareas, s, sumarDias(s, 6)));
  const actual = resultadoSemana(tareas, inicio, sumarDias(inicio, 6));
  const conActual = opts.cierre ? [...pasadas, actual] : pasadas;
  const delTrimestre = (xs: ResultadoSemana[]) => xs.filter((s) => s.inicio >= trimestre);
  const previasTrimestre = delTrimestre(pasadas).filter((s) => s.pct !== null);
  const mejor = previasTrimestre.reduce<ResultadoSemana | null>((m, s) => (!m || (s.pct ?? 0) > (m.pct ?? 0) ? s : m), null);
  const anterior = [...pasadas].reverse().find((s) => s.pct !== null) ?? null;
  const record =
    // Con una sola semana previa en el trimestre, «récord» no dice nada: hacen falta al menos dos.
    opts.cierre && mejor && previasTrimestre.length >= 2 && actual.pct !== null
      ? actual.pct > (mejor.pct ?? 0)
        ? 'supera'
        : actual.pct === mejor.pct
          ? 'iguala'
          : null
      : null;
  return {
    meta: META_SEMANAL,
    actual,
    compromiso: actual.vigentes,
    ya_completadas: actual.completadas,
    anterior: anterior && anterior.inicio === sumarDias(inicio, -7) ? anterior : null,
    racha: racha(conActual),
    mejor_racha_trimestre: mejorRacha(conActual, trimestre),
    mejor_trimestre: mejor,
    record,
    reconocidos: opts.cierre ? reconocidos(tareas, inicio) : [],
  };
}

const semanas = (n: number) => `${n} ${n === 1 ? 'semana' : 'semanas'}`;
const fraccion = (s: ResultadoSemana) => `${s.completadas} de ${s.vigentes} (${s.pct ?? 0} %)`;
const frenteMeta = (p: number, meta: number) => (p >= meta ? 'en la meta' : 'bajo la meta');

/** Bloque «Marcador de la semana» del plan operativo (markdown). */
export function renderMarcadorPlan(m: Marcador): string {
  const filas = [
    `| Compromiso | **${m.compromiso} ${m.compromiso === 1 ? 'tarea' : 'tareas'}** con entrega esta semana${m.ya_completadas ? ` (${m.ya_completadas} ya completadas)` : ''} |`,
    `| Meta de la mesa | **${m.meta} %** completadas |`,
    `| Semana pasada | ${m.anterior ? `${fraccion(m.anterior)}, ${frenteMeta(m.anterior.pct ?? 0, m.meta)}` : 'Sin tareas con entrega'} |`,
    `| Racha | ${semanas(m.racha)} en la meta · mejor racha del trimestre: ${m.mejor_racha_trimestre} |`,
  ];
  if (m.mejor_trimestre) filas.push(`| Mejor semana del trimestre | ${m.mejor_trimestre.pct} % (semana ${m.mejor_trimestre.numero}) |`);
  return ['**Marcador de la semana**', '', '| Indicador | Valor |', '|---|---|', ...filas].join('\n');
}

/** Bloque «Marcador» del acta de cierre, con el reconocimiento si alguien llega (markdown). */
export function renderMarcadorCierre(m: Marcador, canceladas: number, nombre: (id: string) => string): string {
  const a = m.actual;
  const filas = [
    `| Resultado | **${a.completadas} de ${a.vigentes} completadas en la semana (${a.pct ?? 0} %)**${a.tarde ? `; ${a.tarde} ${a.tarde === 1 ? 'se completó' : 'se completaron'} después del domingo` : ''}${canceladas ? `; ${canceladas} ${canceladas === 1 ? 'cancelada no cuenta' : 'canceladas no cuentan'}` : ''} |`,
    `| Meta de la mesa | ${m.meta} %: **${a.pct !== null && a.pct >= m.meta ? 'cumplida' : 'no cumplida'}** |`,
  ];
  if (m.anterior && a.pct !== null && m.anterior.pct !== null) {
    const d = a.pct - m.anterior.pct;
    filas.push(`| Frente a la semana pasada | ${d > 0 ? '+' : ''}${d} puntos (${m.anterior.pct} % → ${a.pct} %) |`);
  }
  filas.push(`| Racha | **${semanas(m.racha)}** en la meta |`);
  if (m.record && m.mejor_trimestre)
    filas.push(
      `| Récord | ${m.record === 'supera' ? 'Nueva mejor semana del trimestre' : 'Iguala la mejor semana del trimestre'} (antes: ${m.mejor_trimestre.pct} %, semana ${m.mejor_trimestre.numero}) |`,
    );
  const lineas = ['**Marcador**', '', '| Indicador | Valor |', '|---|---|', ...filas];
  if (m.reconocidos.length) {
    lineas.push(
      '',
      '**Reconocimiento: entregas a tiempo**',
      '',
      ...m.reconocidos.map((r) => `- ${nombre(r.usuario_id)}: ${r.a_tiempo} de ${r.a_tiempo} a tiempo`),
    );
  }
  return lineas.join('\n');
}
