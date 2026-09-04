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
import type { DailyMensaje } from '../mcp/publish';
import { generarTexto } from './index';

export async function armarDailyMensaje(ctx: DbCtx, mesa: Mesa, tipo: 'apertura' | 'cierre', notas: string[], responsable: string): Promise<DailyMensaje> {
  const [alcance, usuarios, clientes] = await Promise.all([alcanceMesa(ctx, mesa.id), listUsuarios(ctx), listClientes(ctx, { incluirInactivos: true })]);
  const activos = await listBacklog(ctx, { solo_activos: true, mesa: alcance });
  const hoy = fechaLocal();
  const mananaIso = sumarDias(hoy, 1);
  const hace24h = new Date(Date.now() - 86_400_000).toISOString();
  const nombre = (id?: string) => usuarios.find((u) => u.id === id)?.nombre ?? 'sin asignar';
  const cliente = (id: string) => clientes.find((x) => x.id === id)?.nombre ?? '';
  const linea = (r: { titulo_interno: string; cliente_id: string; owner_agencia: string[]; fecha_entrega: string | null }) => `${cliente(r.cliente_id)} · ${r.titulo_interno} · ${nombre(r.owner_agencia[0])}${r.fecha_entrega ? ` · ${r.fecha_entrega}` : ''}`;
  return {
    tipo, responsable, fecha: hoy, notas,
    vencen: activos.filter((r) => r.fecha_entrega && r.fecha_entrega <= mananaIso && r.estado_operativo === 'priorizado').map(linea),
    bloqueos: activos.filter((r) => r.estado_operativo === 'bloqueado' && r.ultima_actualizacion >= hace24h).map(linea),
    cambios: activos.filter((r) => r.veces_reprogramado > 0 && r.ultima_actualizacion >= hace24h).map(linea),
  };
}

const SYSTEM_DAILY = `Redacta el mensaje de {TIPO} de mesa para el board Daily de Basecamp que lee el equipo de producción.
Formato: 3 a 6 líneas de texto plano, sin títulos ni viñetas. Primera línea: foco del día en una frase.
Luego: qué vence y quién lo tiene, bloqueos que hay que destrabar (con el nombre de quien puede destrabar si está en los datos) y cambios de fecha.
En un cierre: qué quedó hecho no lo sabes, así que habla de lo que queda abierto para mañana.
Tono de compañero de mesa, no de jefe. Sin saludos ni despedidas.`;

export async function narrarDaily(ctx: DbCtx, mesa: Mesa, m: DailyMensaje): Promise<string> {
  const payload = { mesa: mesa.nombre, tipo: m.tipo, fecha: m.fecha, notas_del_responsable: m.notas, vencen_hoy_o_manana_sin_iniciar: m.vencen, bloqueos_nuevos_24h: m.bloqueos, fechas_cambiadas_24h: m.cambios };
  const g = await generarTexto(ctx, { tipo: 'daily', entidad: { tipo: 'mesa', id: mesa.id }, payload, system: SYSTEM_DAILY.replace('{TIPO}', m.tipo), maxTokens: 500, cacheMs: 5 * 60_000 });
  return g.texto;
}
