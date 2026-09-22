/**
 * Informe por canal (réplica del tablero "Gráfico TRADE…" de Monday): piezas y tareas por mes, por semana
 * y por canal, con estado, aprobación y prioridad. Un canal = un cliente. Se agrupan varios clientes por
 * `config.grupo` o por lista explícita de ids. Solo cuenta lo registrado en BackIO desde `desde`.
 */
import type { DbCtx } from './db/client';
import { throwIf } from './db/client';

export interface CanalSerie { cliente_id: string; nombre: string; color: string }
export interface InformeCanal {
  titulo: string; desde: string; hasta: string; generado_at: string;
  canales: CanalSerie[];
  totales: { piezas: number; tareas: number; completadas: number; aprobadas: number; pendiente_cliente: number; pct_listo: number };
  por_mes: { mes: string; etiqueta: string; piezas: number; tareas: number; por_canal: Record<string, { piezas: number; tareas: number }> }[];
  por_semana: { semana: string; etiqueta: string; piezas: number; tareas: number }[];
  estado: { completadas: number; en_proceso: number; otras: number };
  aprobacion: { aprobado: number; pendiente_cliente: number; pendiente_interno: number; otros: number };
  prioridad: { alta: number; media: number; baja: number };
  sin_piezas: number;
}

const PALETA = ['#9BD24E', '#FF7F41', '#7E3FBF', '#1F77B4', '#F0B429', '#2CA58D', '#E4405F', '#5D6D7E'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function lunesDe(iso: string): string { const d = new Date(`${iso}T12:00:00Z`); const dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow); return d.toISOString().slice(0, 10); }
function mesesEntre(desde: string, hasta: string): string[] { const out: string[] = []; let [y, m] = desde.slice(0, 7).split('-').map(Number); const fin = hasta.slice(0, 7); for (let i = 0; i < 36; i++) { const k = `${y}-${String(m).padStart(2, '0')}`; out.push(k); if (k >= fin) break; m! += 1; if (m! > 12) { m = 1; y! += 1; } } return out; }
function semanasEntre(desde: string, hasta: string): string[] { const out: string[] = []; let d = lunesDe(desde); const fin = lunesDe(hasta); for (let i = 0; i < 120 && d <= fin; i++) { out.push(d); const n = new Date(`${d}T12:00:00Z`); n.setUTCDate(n.getUTCDate() + 7); d = n.toISOString().slice(0, 10); } return out; }

export async function informeCanal(ctx: DbCtx, o: { clienteIds: string[]; desde: string; hasta: string; titulo?: string }): Promise<InformeCanal> {
  const { data: cls, error: e1 } = await ctx.db.from('clientes').select('id, nombre, color_primario, config').eq('tenant_id', ctx.tenantId).in('id', o.clienteIds);
  throwIf(e1);
  const clientes = ((cls ?? []) as { id: string; nombre: string; color_primario: string | null; config: Record<string, unknown> }[]).sort((a, b) => o.clienteIds.indexOf(a.id) - o.clienteIds.indexOf(b.id));
  const canales: CanalSerie[] = clientes.map((c, i) => ({ cliente_id: c.id, nombre: String((c.config as { canal?: string })?.canal ?? (c.nombre.replace(/^.*?(?:TRADE(?: KKAA)?:\s*)/i, '').replace(/\s*-\s*FEE.*$/i, '').trim() || c.nombre)), color: PALETA[i % PALETA.length]! }));
  type R = { cliente_id: string; piezas: number; estado_operativo: string; estado_aprobacion: string; prioridad: string; fecha_pedido: string | null; created_at: string; completado_at: string | null };
  const filas: R[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await ctx.db.from('requerimientos').select('cliente_id, piezas, estado_operativo, estado_aprobacion, prioridad, fecha_pedido, created_at, completado_at').eq('tenant_id', ctx.tenantId).in('cliente_id', o.clienteIds).is('deleted_at', null).neq('estado_operativo', 'cancelado').order('id').range(from, from + 999);
    throwIf(error); const r = (data ?? []) as R[]; filas.push(...r); if (r.length < 1000) break;
  }
  const fechaGen = (r: R) => (r.fecha_pedido ?? r.created_at.slice(0, 10));
  const enRango = filas.filter((r) => { const f = fechaGen(r); return f >= o.desde && f <= o.hasta; });
  const piezasDe = (rs: R[]) => rs.reduce((s, r) => s + (Number(r.piezas) || 0), 0);
  const por_mes = mesesEntre(o.desde, o.hasta).map((mes) => {
    const rs = enRango.filter((r) => fechaGen(r).slice(0, 7) === mes);
    const por_canal: Record<string, { piezas: number; tareas: number }> = {};
    for (const c of canales) { const rc = rs.filter((r) => r.cliente_id === c.cliente_id); por_canal[c.cliente_id] = { piezas: piezasDe(rc), tareas: rc.length }; }
    const [y, m] = mes.split('-').map(Number);
    return { mes, etiqueta: `${MESES_L[m! - 1]} ${y}`, piezas: piezasDe(rs), tareas: rs.length, por_canal };
  });
  const entregadas = filas.filter((r) => r.completado_at && r.completado_at.slice(0, 10) >= o.desde && r.completado_at.slice(0, 10) <= o.hasta);
  const por_semana = semanasEntre(o.desde, o.hasta).map((sem) => { const rs = entregadas.filter((r) => lunesDe((r.completado_at as string).slice(0, 10)) === sem); const [, m, d] = sem.split('-').map(Number); return { semana: sem, etiqueta: `${d} ${MESES[m! - 1]}`, piezas: piezasDe(rs), tareas: rs.length }; });
  const completadas = enRango.filter((r) => r.estado_operativo === 'completado').length;
  const aprobadas = enRango.filter((r) => r.estado_aprobacion === 'aprobado').length;
  const pendCli = enRango.filter((r) => r.estado_aprobacion === 'pendiente_cliente').length;
  return {
    titulo: o.titulo ?? `Gráfico ${canales.map((c) => c.nombre).join(' / ')}`, desde: o.desde, hasta: o.hasta, generado_at: new Date().toISOString(), canales,
    totales: { piezas: piezasDe(enRango), tareas: enRango.length, completadas, aprobadas, pendiente_cliente: pendCli, pct_listo: enRango.length ? Math.round((completadas / enRango.length) * 1000) / 10 : 0 },
    por_mes, por_semana,
    estado: { completadas, en_proceso: enRango.filter((r) => ['en_ejecucion', 'en_revision'].includes(r.estado_operativo)).length, otras: enRango.length - completadas - enRango.filter((r) => ['en_ejecucion', 'en_revision'].includes(r.estado_operativo)).length },
    aprobacion: { aprobado: aprobadas, pendiente_cliente: pendCli, pendiente_interno: enRango.filter((r) => r.estado_aprobacion === 'pendiente_interno').length, otros: enRango.filter((r) => !['aprobado', 'pendiente_cliente', 'pendiente_interno'].includes(r.estado_aprobacion)).length },
    // Crítico se fusiona con Alta (decidido por Luis 22/09/2026).
    prioridad: { alta: enRango.filter((r) => r.prioridad === 'alta').length, media: enRango.filter((r) => r.prioridad === 'media').length, baja: enRango.filter((r) => r.prioridad === 'baja').length },
    sin_piezas: enRango.filter((r) => !r.piezas).length,
  };
}

/** Grupos de clientes por config.grupo (p. ej. "AB-Inbev") + presets guardados en tenants.config.informes_canal. */
export async function gruposInforme(ctx: DbCtx): Promise<{ id: string; nombre: string; cliente_ids: string[] }[]> {
  const { data: cls } = await ctx.db.from('clientes').select('id, nombre, config').eq('tenant_id', ctx.tenantId).eq('activo', true);
  const clientes = (cls ?? []) as { id: string; nombre: string; config: Record<string, unknown> }[];
  const porGrupo = new Map<string, string[]>();
  for (const c of clientes) { const g = (c.config as { grupo?: string })?.grupo; if (g) porGrupo.set(g, [...(porGrupo.get(g) ?? []), c.id]); }
  const out = [...porGrupo.entries()].map(([g, ids]) => ({ id: `grupo:${g}`, nombre: `${g} (todas las ramas)`, cliente_ids: ids }));
  const { data: t } = await ctx.db.from('tenants').select('config').eq('id', ctx.tenantId).single();
  const presets = ((t as { config?: { informes_canal?: { id: string; nombre: string; cliente_ids: string[] }[] } } | null)?.config?.informes_canal) ?? [];
  // Además, cada cliente activo como opción propia: el informe sirve para cualquier cuenta, no solo grupos.
  const individuales = clientes.filter((c) => !(c.config as { grupo?: string })?.grupo || true).map((c) => ({ id: `cliente:${c.id}`, nombre: c.nombre, cliente_ids: [c.id] })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  return [...presets, ...out, ...individuales];
}
