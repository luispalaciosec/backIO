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
import { fechaLocal, sumarDias } from '../rituals/daily';
import { dailyItemTexto, type DailyItem, type DailyMensaje } from '../mcp/publish';
import { generarTexto } from './index';

/** El daily no se arma ni se publica con tareas sin responsable: nadie sabría a quién preguntar. */
export class DailySinResponsable extends Error {
  constructor(public tareas: string[]) { super(`El daily tiene ${tareas.length} tarea${tareas.length === 1 ? '' : 's'} sin responsable. Asigna a alguien antes de publicar: ${tareas.slice(0, 5).join('; ')}${tareas.length > 5 ? '…' : ''}`); }
}

export async function armarDailyMensaje(ctx: DbCtx, mesa: Mesa, tipo: 'apertura' | 'cierre', notas: string[], responsable: string): Promise<DailyMensaje> {
  const [alcance, usuarios, clientes] = await Promise.all([alcanceMesa(ctx, mesa.id), listUsuarios(ctx), listClientes(ctx, { incluirInactivos: true })]);
  const activos = await listBacklog(ctx, { solo_activos: true, mesa: alcance });
  const hoy = fechaLocal();
  const mananaIso = sumarDias(hoy, 1);
  const hace24h = new Date(Date.now() - 86_400_000).toISOString();
  const nombre = (id?: string) => usuarios.find((u) => u.id === id)?.nombre ?? 'sin asignar';
  const cliente = (id: string) => clientes.find((x) => x.id === id)?.nombre ?? '';
  const linea = (r: { titulo_interno: string; cliente_id: string; owner_agencia: string[]; fecha_entrega: string | null; basecamp_url: string | null; dias_atraso: number }): DailyItem => ({
    cliente: cliente(r.cliente_id), titulo: r.titulo_interno, owner: nombre(r.owner_agencia[0]), owners: r.owner_agencia.map(nombre), fecha: r.fecha_entrega, url: r.basecamp_url, atraso_dias: r.dias_atraso > 0 ? r.dias_atraso : undefined,
  });
  const sinResp = activos.filter((r) => r.owner_agencia.length === 0 && (r.daily_fecha === hoy || (r.fecha_entrega && r.fecha_entrega <= mananaIso && r.estado_operativo === 'priorizado') || (r.estado_operativo === 'bloqueado' && r.ultima_actualizacion >= hace24h) || (r.veces_reprogramado > 0 && r.ultima_actualizacion >= hace24h)));
  if (sinResp.length) throw new DailySinResponsable(sinResp.map((r) => `${r.titulo_interno} (${cliente(r.cliente_id)})`));
  return {
    tipo, responsable, fecha: hoy, notas,
    hoy: activos.filter((r) => r.daily_fecha === hoy).map(linea),
    vencen: activos.filter((r) => r.fecha_entrega && r.fecha_entrega <= mananaIso && r.estado_operativo === 'priorizado').map(linea),
    bloqueos: activos.filter((r) => r.estado_operativo === 'bloqueado' && r.ultima_actualizacion >= hace24h).map(linea),
    cambios: activos.filter((r) => r.veces_reprogramado > 0 && r.ultima_actualizacion >= hace24h).map(linea),
  };
}

const SYSTEM_DAILY = `Redacta el mensaje de {TIPO} de mesa para el board Daily de Basecamp que lee el equipo de producción.
Formato OBLIGATORIO (markdown simple, se convierte a HTML):
- Bloques separados por una línea en blanco.
- Cada bloque empieza con un título en negrita con emoji, en su propia línea: **🎯 Foco del día**, **📋 En la mesa hoy**, **⏰ Vence hoy o mañana**, **⛔ Bloqueos**, **📅 Cambios de fecha** y, solo en un cierre, **➡️ Para mañana**.
- Debajo de cada título, viñetas con "- " (una idea por viñeta, máximo 4 por bloque). El foco del día es una sola frase sin viñeta.
- Nombres de tareas en negrita (**así**) y el responsable después de dos puntos. Omite un bloque si no hay nada que decir en él.
- Fechas como día/mes (22/09), nunca 2026-09-22. Sin títulos con #, sin tablas, sin saludos ni despedidas. El bloque **➡️ Para mañana** solo existe en un cierre; en una apertura no lo pongas.
Contenido: el foco del día en una frase; qué se trabaja hoy (la selección de la mesa) agrupado por persona; qué vence y quién lo tiene; bloqueos que hay que destrabar (con el nombre de quien puede destrabar si está en los datos); cambios de fecha.
En un cierre: qué quedó hecho no lo sabes, así que habla de lo que queda abierto para mañana.
Tono de compañero de mesa, no de jefe.`;

export async function narrarDaily(ctx: DbCtx, mesa: Mesa, m: DailyMensaje): Promise<string> {
  const payload = { mesa: mesa.nombre, tipo: m.tipo, fecha: m.fecha, notas_del_responsable: m.notas, hoy_se_trabaja: m.hoy.map(dailyItemTexto), vencen_hoy_o_manana_sin_iniciar: m.vencen.map(dailyItemTexto), bloqueos_nuevos_24h: m.bloqueos.map(dailyItemTexto), fechas_cambiadas_24h: m.cambios.map(dailyItemTexto) };
  const g = await generarTexto(ctx, { tipo: 'daily', entidad: { tipo: 'mesa', id: mesa.id }, payload, system: SYSTEM_DAILY.replace('{TIPO}', m.tipo), maxTokens: 900, cacheMs: 5 * 60_000 });
  return g.texto;
}
