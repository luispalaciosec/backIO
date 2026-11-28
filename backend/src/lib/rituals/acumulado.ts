/**
 * Weekly acumulado (docs/05-rituales.md, plan aprobado el 27/11/2026): todo lo que hizo la mesa en la semana, por equipo y
 * persona, con el estado de cada tarea y sus piezas. Es otra FORMA del weekly; el FONDO es la regla del daily (entregas
 * ÷ entregas comprometidas) contada por semana: cada tarea UNA vez (revisión en vivo del 28/11: sumar el cierre de cada
 * día contaba varias veces la tarea que se arrastraba, y daba 33 % a un equipo con 7 entregadas y 1 pendiente). Función
 * pura: los datos llegan cargados.
 */
import { diaLocal, porcentaje, semaforo, type ColorSemaforo } from '@backio/shared';
import { diasHabiles, type DatosMesa, type TareaEvo } from '../evolutivo';

export type EstadoSemana = 'terminada' | 'revision' | 'ajustes' | 'no_cumplida' | 'nueva' | 'en_curso';

/** Orden de precedencia: el primero que aplica. También es el orden en que se listan. */
export const ESTADOS_SEMANA: { estado: EstadoSemana; icono: string; etiqueta: string }[] = [
  { estado: 'terminada', icono: '✅', etiqueta: 'Terminada' },
  { estado: 'revision', icono: '🔎', etiqueta: 'Revisión del cliente' },
  { estado: 'ajustes', icono: '⚠️', etiqueta: 'Ajustes solicitados' },
  { estado: 'no_cumplida', icono: '❌', etiqueta: 'No se cumplió' },
  { estado: 'nueva', icono: '🎯', etiqueta: 'Nueva' },
  { estado: 'en_curso', icono: '🛠️', etiqueta: 'En curso' },
];
const ORDEN = new Map(ESTADOS_SEMANA.map((e, i) => [e.estado, i]));
/** Piezas que salieron de nuestro lado esta semana: terminadas o entregadas al cliente (en revisión o con ajustes). */
const REALIZADAS = new Set<EstadoSemana>(['terminada', 'revision', 'ajustes']);
/** Cumplimiento: entregadas (terminadas o en manos del cliente) ÷ todo lo que tocaba entregar. Nuevas y en curso no entran. */
const ENTREGADAS = new Set<EstadoSemana>(['terminada', 'revision']);
const COMPROMETIDAS = new Set<EstadoSemana>(['terminada', 'revision', 'ajustes', 'no_cumplida']);

export interface TareaSemana {
  id: string;
  estado: EstadoSemana;
  cliente: string;
  titulo: string;
  url: string | null;
  fecha: string | null;
  piezas: number;
  con_ayuda_de: string[];
}
export interface Conteo {
  total: number;
  piezas: number;
  por_estado: Record<EstadoSemana, number>;
  /** Entregadas (✅ + 🔎) y todo lo que tocaba entregar (✅ + 🔎 + ⚠️ + ❌), cada tarea una vez. */
  cerradas_plan: number;
  para_entregar: number;
  cumplimiento_pct: number | null;
  semaforo: ColorSemaforo | null;
}
export interface PersonaSemana extends Conteo {
  usuario_id: string;
  nombre: string;
  tareas: TareaSemana[];
}
export interface EquipoSemana extends Conteo {
  nombre: string;
  participacion_piezas_pct: number | null;
  personas: PersonaSemana[];
}
export interface AcumuladoSemana {
  semana: { inicio: string; fin: string; dias_medidos: string[] };
  resumen: Conteo;
  equipos: EquipoSemana[];
  estados: typeof ESTADOS_SEMANA;
}

export const SIN_EQUIPO = 'Sin equipo';

const vacio = (): Record<EstadoSemana, number> => ({ terminada: 0, revision: 0, ajustes: 0, no_cumplida: 0, nueva: 0, en_curso: 0 });

/** Estado de una tarea al cierre de la semana (o a hoy, si la semana está en curso). */
export function estadoEnSemana(
  t: TareaEvo,
  s: { inicio: string; fin: string; cerradaEnSemana: boolean; conAjustes: boolean },
): EstadoSemana {
  if (s.cerradaEnSemana) return 'terminada';
  if (t.estado_aprobacion === 'pendiente_cliente') return 'revision';
  if (s.conAjustes || t.estado_aprobacion === 'rechazado') return 'ajustes';
  if (t.fecha_entrega && t.fecha_entrega <= s.fin) return 'no_cumplida';
  const pedida = t.fecha_pedido ?? diaLocal(t.created_at);
  if (pedida >= s.inicio && pedida <= s.fin) return 'nueva';
  return 'en_curso';
}

export function armarAcumulado(p: {
  datos: Pick<DatosMesa, 'tareas' | 'reprocesos' | 'reprogramaciones' | 'nombres' | 'avance' | 'cierres'>;
  semana: { inicio: string; fin: string };
  /** Selección de cada día hábil medido (de la foto del evolutivo; el de hoy, en vivo). */
  selecciones: Map<string, Set<string>>;
  hoy: string;
  reprocesosAbiertos: Set<string>;
  /** Equipo de cada cliente; sin entrada, el cliente va a «Sin equipo». */
  equipoDe: Map<string, string>;
  clientes: Map<string, string>;
}): AcumuladoSemana {
  const { semana, datos } = p;
  const ultimo = p.hoy < semana.fin ? p.hoy : semana.fin;
  const dias = diasHabiles(semana.inicio, ultimo);
  const enSemana = (d: string | null | undefined) => !!d && d >= semana.inicio && d <= semana.fin;
  const cierresEnSemana = new Set(datos.cierres.filter((c) => enSemana(c.dia)).map((c) => c.requerimiento_id));
  const cerradaEnSemana = (t: TareaEvo) => cierresEnSemana.has(t.id) || enSemana(diaLocal(t.completado_at ?? null));
  const elegidas = new Set([...p.selecciones.values()].flatMap((s) => [...s]));

  // Tareas de la semana: elegidas en algún daily, cerradas, pedidas o que vencían en la semana. Canceladas fuera.
  const tareas = datos.tareas.filter(
    (t) =>
      (t.estado_operativo !== 'cancelado' || cerradaEnSemana(t)) &&
      (elegidas.has(t.id) || cerradaEnSemana(t) || enSemana(t.fecha_pedido ?? diaLocal(t.created_at)) || enSemana(t.fecha_entrega)),
  );
  const estadoDe = new Map(
    tareas.map((t) => [
      t.id,
      estadoEnSemana(t, { ...semana, cerradaEnSemana: cerradaEnSemana(t), conAjustes: p.reprocesosAbiertos.has(t.id) }),
    ]),
  );

  const conteo = (ts: TareaEvo[]): Conteo => {
    const por_estado = vacio();
    let piezas = 0,
      entregadas = 0,
      comprometidas = 0;
    for (const t of ts) {
      const e = estadoDe.get(t.id)!;
      por_estado[e] += 1;
      if (REALIZADAS.has(e)) piezas += Number(t.piezas) || 0;
      if (ENTREGADAS.has(e)) entregadas += 1;
      if (COMPROMETIDAS.has(e)) comprometidas += 1;
    }
    const pct = porcentaje(entregadas, comprometidas);
    return {
      total: ts.length,
      piezas,
      por_estado,
      cerradas_plan: entregadas,
      para_entregar: comprometidas,
      cumplimiento_pct: pct,
      semaforo: semaforo(pct),
    };
  };

  const fila = (t: TareaEvo, persona: string): TareaSemana => ({
    id: t.id,
    estado: estadoDe.get(t.id)!,
    cliente: p.clientes.get(t.cliente_id ?? '') ?? '—',
    titulo: t.titulo_interno ?? '—',
    url: t.basecamp_url ?? null,
    fecha: t.fecha_entrega,
    piezas: Number(t.piezas) || 0,
    con_ayuda_de: t.owner_agencia.filter((o) => o !== persona).map((o) => datos.nombres.get(o) ?? '—'),
  });
  const ordenar = (a: TareaSemana, b: TareaSemana) =>
    ORDEN.get(a.estado)! - ORDEN.get(b.estado)! || a.cliente.localeCompare(b.cliente, 'es') || a.titulo.localeCompare(b.titulo, 'es');

  const resumen = conteo(tareas);
  const porEquipo = new Map<string, TareaEvo[]>();
  for (const t of tareas) {
    const e = p.equipoDe.get(t.cliente_id ?? '')?.trim() || SIN_EQUIPO;
    porEquipo.set(e, [...(porEquipo.get(e) ?? []), t]);
  }
  const equipos: EquipoSemana[] = [...porEquipo.entries()]
    .sort(([a], [b]) => (a === SIN_EQUIPO ? 1 : b === SIN_EQUIPO ? -1 : a.localeCompare(b, 'es')))
    .map(([nombre, ts]) => {
      const c = conteo(ts);
      const personas = new Map<string, TareaEvo[]>();
      for (const t of ts) for (const o of t.owner_agencia) personas.set(o, [...(personas.get(o) ?? []), t]);
      return {
        nombre,
        ...c,
        participacion_piezas_pct: porcentaje(c.piezas, resumen.piezas),
        personas: [...personas.entries()]
          .map(([uid, pts]) => ({
            usuario_id: uid,
            nombre: datos.nombres.get(uid) ?? '—',
            ...conteo(pts),
            tareas: pts.map((t) => fila(t, uid)).sort(ordenar),
          }))
          .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, 'es')),
      };
    });
  return { semana: { ...semana, dias_medidos: dias }, resumen, equipos, estados: ESTADOS_SEMANA };
}

/** Enlace de un mensaje de Basecamp: 3.basecamp.com/<cuenta>/buckets/<proyecto>/messages/<id>. */
export function mensajeDeEnlace(url: string): { proyecto: number; mensaje: number } | null {
  const m = /^https:\/\/3\.basecamp\.com\/\d+\/buckets\/(\d+)\/messages\/(\d+)/.exec(url.trim());
  return m ? { proyecto: Number(m[1]), mensaje: Number(m[2]) } : null;
}
