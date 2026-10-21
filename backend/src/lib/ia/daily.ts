/**
 * Daily narrado: arma el mensaje estructurado (mismos datos que el daily) y lo redacta.
 * La persona que abre/cierra la mesa edita y publica.
 */
import type { Mesa } from '@backio/shared';
import type { DbCtx } from '../db/client';
import { listBacklog } from '../db/requerimientos';
import { listUsuarios } from '../db/usuarios';
import { listClientes } from '../db/clientes';
import { alcanceMesa } from '../db/mesas';
import { listReprocesosDelDia } from '../db/ia';
import { dailyItemTexto, type DailyItem, type DailyMensaje, type DailyKpis } from '../mcp/publish';
import { generarTexto } from './index';
import { hoyLocal, inicioDiaLocal, sumarDias, nombrePersona } from '@backio/shared';

/** El daily no se arma ni se publica con tareas sin responsable: nadie sabría a quién preguntar. */
export class DailySinResponsable extends Error {
  constructor(public tareas: string[]) {
    super(
      `El daily tiene ${tareas.length} tarea${tareas.length === 1 ? '' : 's'} sin responsable. Asigna a alguien antes de publicar: ${tareas.slice(0, 5).join('; ')}${tareas.length > 5 ? '…' : ''}`,
    );
  }
}

export async function armarDailyMensaje(
  ctx: DbCtx,
  mesa: Mesa,
  tipo: 'apertura' | 'cierre',
  notas: string[],
  responsable: string,
): Promise<DailyMensaje> {
  const [alcance, usuarios, clientes] = await Promise.all([
    alcanceMesa(ctx, mesa.id, { sinPrueba: true }),
    listUsuarios(ctx, { incluirInactivos: true }),
    listClientes(ctx, { incluirInactivos: true }),
  ]);
  const activos = await listBacklog(ctx, { solo_activos: true, mesa: alcance });
  const hoy = hoyLocal();
  const mananaIso = sumarDias(hoy, 1);
  const hace24h = new Date(Date.now() - 86_400_000).toISOString();
  const nombre = (id?: string) => {
    const u = usuarios.find((x) => x.id === id);
    return u ? nombrePersona(u) : 'sin asignar';
  };
  const cliente = (id: string) => clientes.find((x) => x.id === id)?.nombre ?? '';
  const linea = (r: {
    titulo_interno: string;
    cliente_id: string;
    owner_agencia: string[];
    fecha_entrega: string | null;
    basecamp_url: string | null;
    dias_atraso: number;
  }): DailyItem => ({
    cliente: cliente(r.cliente_id),
    titulo: r.titulo_interno,
    owner: nombre(r.owner_agencia[0]),
    owners: r.owner_agencia.map(nombre),
    fecha: r.fecha_entrega,
    url: r.basecamp_url,
    atraso_dias: r.dias_atraso > 0 ? r.dias_atraso : undefined,
  });
  const sinResp = activos.filter(
    (r) =>
      r.owner_agencia.length === 0 &&
      (r.daily_fecha === hoy ||
        (r.fecha_entrega && r.fecha_entrega <= mananaIso && r.estado_operativo === 'priorizado') ||
        (r.estado_operativo === 'bloqueado' && r.ultima_actualizacion >= hace24h) ||
        (r.veces_reprogramado > 0 && r.ultima_actualizacion >= hace24h)),
  );
  if (sinResp.length) throw new DailySinResponsable(sinResp.map((r) => `${r.titulo_interno} (${cliente(r.cliente_id)})`));
  // Cierre: qué se completó hoy (completado_at desde las 00:00 de Guayaquil), separando lo que estaba en el daily de lo que no.
  let completadas: DailyItem[] = [],
    completadasFuera: DailyItem[] = [],
    kpis: DailyKpis | undefined;
  if (tipo === 'cierre') {
    const inicioDia = inicioDiaLocal(hoy);
    const hechas = (await listBacklog(ctx, { estado: 'completado', mesa: alcance })).filter(
      (r) => r.completado_at && r.completado_at >= inicioDia,
    );
    completadas = hechas.filter((r) => r.daily_fecha === hoy).map(linea);
    completadasFuera = hechas.filter((r) => r.daily_fecha !== hoy).map(linea);
    // Métricas del día: plan (daily_fecha = hoy) vs cerradas, entradas fuera de planificación, reprocesos, etc.
    const todas = [...activos, ...hechas];
    const planificadas = todas.filter((r) => r.daily_fecha === hoy);
    const nuevas = todas.filter((r) => r.created_at >= inicioDia);
    const rep = await listReprocesosDelDia(
      ctx,
      inicioDia,
      todas.map((r) => r.id),
    );
    const porPersona = new Map<string, { nombre: string; planificadas: number; cerradas: number; fuera: number }>();
    const pp = (id: string) => {
      const n = nombre(id);
      if (!porPersona.has(n)) porPersona.set(n, { nombre: n, planificadas: 0, cerradas: 0, fuera: 0 });
      return porPersona.get(n)!;
    };
    for (const r of planificadas)
      for (const o of r.owner_agencia) {
        const x = pp(o);
        x.planificadas += 1;
        if (r.estado_operativo === 'completado') x.cerradas += 1;
      }
    for (const r of hechas.filter((r) => r.daily_fecha !== hoy)) for (const o of r.owner_agencia) pp(o).fuera += 1;
    const cerradasPlan = planificadas.filter((r) => r.estado_operativo === 'completado').length;
    kpis = {
      planificadas: planificadas.length,
      cerradas_planificadas: cerradasPlan,
      cumplimiento_pct: planificadas.length ? Math.round((cerradasPlan / planificadas.length) * 100) : null,
      cerradas_fuera: completadasFuera.length,
      cerradas_total: hechas.length,
      nuevas_hoy: nuevas.length,
      nuevas_no_planificadas: nuevas.filter((r) => r.planificacion === 'no_planificado').length,
      nuevas_urgentes: nuevas.filter((r) => r.planificacion === 'urgente').length,
      reprocesos_hoy: rep.length,
      reprogramaciones_24h: activos.filter((r) => r.veces_reprogramado > 0 && r.ultima_actualizacion >= hace24h).length,
      bloqueos_nuevos: activos.filter((r) => r.estado_operativo === 'bloqueado' && r.ultima_actualizacion >= hace24h).length,
      vencidas_abiertas: activos.filter((r) => r.dias_atraso > 0).length,
      por_persona: [...porPersona.values()].sort((a, b) => b.planificadas - a.planificadas || a.nombre.localeCompare(b.nombre, 'es')),
    };
  }
  return {
    tipo,
    responsable,
    fecha: hoy,
    notas,
    ...(tipo === 'cierre' ? { completadas, completadas_fuera: completadasFuera, kpis } : {}),
    hoy: activos.filter((r) => r.daily_fecha === hoy).map(linea),
    vencen: activos.filter((r) => r.fecha_entrega && r.fecha_entrega <= mananaIso && r.estado_operativo === 'priorizado').map(linea),
    bloqueos: activos.filter((r) => r.estado_operativo === 'bloqueado' && r.ultima_actualizacion >= hace24h).map(linea),
    cambios: activos.filter((r) => r.veces_reprogramado > 0 && r.ultima_actualizacion >= hace24h).map(linea),
  };
}

/**
 * Secciones del daily, en su orden y con su título fijo. Los títulos con emoji son el formato del equipo en Basecamp
 * (decisión de Luis, 11/10): los pone el código, no la IA, para que no varíen de un día a otro.
 */
export const SECCIONES_DAILY: Record<'apertura' | 'cierre', [clave: string, titulo: string][]> = {
  apertura: [
    ['foco', '🎯 Foco del día'],
    ['mesa', '📋 En la mesa hoy'],
    ['vence', '⏰ Vence hoy o mañana'],
    ['bloqueos', '⛔ Bloqueos'],
    ['cambios', '📅 Cambios de fecha'],
  ],
  cierre: [
    ['balance', '🎯 Balance del día'],
    ['completado', '✅ Completado hoy'],
    ['fuera', '➕ Completadas fuera del daily'],
    ['abierto', '⏳ Quedó abierto'],
    ['bloqueos', '⛔ Bloqueos'],
    ['manana', '➡️ Para mañana'],
  ],
};

/**
 * Arma el mensaje con los títulos fijos a partir del texto de la IA, que marca cada sección con `[[clave]]`.
 * Respeta el orden canónico, omite secciones vacías o desconocidas y las que no corresponden al tipo. Si la IA no
 * usó ninguna marca, devuelve su texto tal cual (mejor publicar algo que fallar).
 */
export function armarDaily(tipo: 'apertura' | 'cierre', texto: string): string {
  const partes = new Map<string, string[]>();
  let actual: string | null = null;
  for (const linea of texto.split('\n')) {
    const m = /^\s*\[\[([a-z_]+)\]\]\s*$/.exec(linea);
    if (m) {
      actual = m[1]!;
      if (!partes.has(actual)) partes.set(actual, []);
      continue;
    }
    if (actual) partes.get(actual)!.push(linea);
  }
  if (!partes.size) return texto.trim();
  return SECCIONES_DAILY[tipo]
    .map(([clave, titulo]) => {
      const cuerpo = (partes.get(clave) ?? []).join('\n').trim();
      return cuerpo ? `**${titulo}**\n${cuerpo}` : null;
    })
    .filter((x): x is string => x !== null)
    .join('\n\n');
}

const claves = (tipo: 'apertura' | 'cierre') => SECCIONES_DAILY[tipo].map(([c]) => `[[${c}]]`).join(', ');

const SYSTEM_DAILY = `Redacta el mensaje de {TIPO} de mesa para el board Daily de Basecamp que lee el equipo de producción.
Formato OBLIGATORIO (markdown simple, se convierte a HTML):
- Cada sección empieza con una línea que contiene SOLO su marca, sin título: {CLAVES}. El sistema pone los títulos.
  En una apertura: foco (una sola frase sin viñeta), mesa (lo que se trabaja hoy, por persona), vence (qué vence y quién lo tiene), bloqueos, cambios (fechas movidas).
  En un cierre: balance (una frase que lea el cumplimiento del plan y lo que entró sin planificar), completado (por persona), fuera (lo cerrado sin estar en la selección del día, por persona), abierto (lo de hoy que no se cerró, por persona), bloqueos, manana (qué sigue mañana).
- Debajo de cada marca, viñetas con "- " (una idea por viñeta, máximo 4). Omite la sección entera si no hay nada que decir.
- Nombres de tareas en negrita (**así**) y el responsable después de dos puntos.
- Fechas como día/mes (22/09), nunca 2026-09-22. Sin títulos propios, sin #, sin tablas, sin emojis, sin saludos ni despedidas.
Contenido: bloqueos que hay que destrabar (con el nombre de quien puede destrabar si está en los datos).
No relaciones tareas entre sí ni agregues causas o consecuencias que no estén en los datos.
En un cierre: kpis trae los indicadores del día (cumplimiento del plan, entradas fuera de planificación, reprocesos, vencidas abiertas); úsalos en el balance con sus números, sin inventar otros. completadas_hoy y completadas_fuera_del_daily son lo que sí se cerró (dilo por persona, reconociendo el trabajo sin exagerar); hoy_se_trabaja es lo que quedó abierto de la selección del día.
Tono de compañero de mesa, no de jefe.`;

export async function narrarDaily(ctx: DbCtx, mesa: Mesa, m: DailyMensaje): Promise<string> {
  const payload = {
    mesa: mesa.nombre,
    tipo: m.tipo,
    fecha: m.fecha,
    notas_del_responsable: m.notas,
    ...(m.tipo === 'cierre'
      ? {
          kpis: m.kpis,
          completadas_hoy: (m.completadas ?? []).map(dailyItemTexto),
          completadas_fuera_del_daily: (m.completadas_fuera ?? []).map(dailyItemTexto),
        }
      : {}),
    hoy_se_trabaja: m.hoy.map(dailyItemTexto),
    vencen_hoy_o_manana_sin_iniciar: m.vencen.map(dailyItemTexto),
    bloqueos_nuevos_24h: m.bloqueos.map(dailyItemTexto),
    fechas_cambiadas_24h: m.cambios.map(dailyItemTexto),
  };
  const g = await generarTexto(ctx, {
    tipo: 'daily',
    entidad: { tipo: 'mesa', id: mesa.id },
    payload,
    system: SYSTEM_DAILY.replace('{TIPO}', m.tipo).replace('{CLAVES}', claves(m.tipo)),
    maxTokens: 900,
    cacheMs: 5 * 60_000,
  });
  return armarDaily(m.tipo, g.texto);
}
