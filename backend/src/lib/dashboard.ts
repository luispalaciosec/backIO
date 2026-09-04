/**
 * Fase 4 · Dashboards. Agregados calculados sobre la vista de métricas; sin tablas nuevas.
 * Todo por tenant, con filtro opcional por mesa. Nunca texto de Basecamp (no existe en la base).
 */
import type { RequerimientoMetricas, Proyecto, Usuario, Cliente, Mesa, Semana } from '@backio/shared';
import type { DbCtx } from './db/client';
import { throwIf } from './db/client';
import { listBacklog } from './db/requerimientos';
import { listProyectos } from './db/proyectos';
import { listUsuarios } from './db/usuarios';
import { listClientes } from './db/clientes';
import { listMesas, alcanceMesa } from './db/mesas';
import { fechaLocal } from './rituals/daily';
import { lunesDe } from './builder/plan';
import { listCumplimientoDesde } from './db/historial';
import { resumirCumplimiento, labelMotivoReprogramacion, labelMotivoReproceso } from './cumplimiento';
import { resumenHoras } from './horas';

export interface DashboardKpis {
  activos: number;
  atrasados: number;
  sin_movimiento_14: number;
  esperando_cliente: number;
  bloqueados: number;
  reprogramados_2mas: number;
  completados_30d: number;
  piezas_completadas_30d: number;
  piezas_activas: number;
  proyectos_activos: number;
  avance_promedio: number;
  horas_30d: number;
  huerfanos_pendientes: number;
  /** Cumplimiento 30d sobre la fecha ORIGINAL (dato real) y sobre la vigente. */
  pct_a_tiempo_original_30d: number | null;
  pct_a_tiempo_vigente_30d: number | null;
  reprogramaciones_30d: number;
  reprocesos_30d: number;
  horas_reproceso_30d: number;
}

export interface FilaCliente {
  cliente_id: string; cliente: string; mesa: string | null;
  activos: number; atrasados: number; esperando_cliente: number; sin_movimiento_max: number; completados_30d: number; piezas_activas: number;
  proyectos: number; avance_promedio: number; salud: 'verde' | 'amarillo' | 'rojo';
  horas_30d: number; valor_cotizado_activo: number;
  pct_a_tiempo_original_30d: number | null; reprocesos_30d: number; reprogramaciones_30d: number;
}

export interface FilaPersona { usuario_id: string; nombre: string; activos: number; semana_actual: number; atrasados: number; capacidad_semanal: number; pct_semana: number; horas_30d: number; entregados_30d: number; pct_a_tiempo_original_30d: number | null; pct_a_tiempo_vigente_30d: number | null; desvio_mediana_dias: number | null; reprogramaciones_equipo_30d: number; reprocesos_30d: number; motivo_reprogramacion_dominante: string | null; motivo_reproceso_dominante: string | null }

export interface SerieSemana { semana_inicio: string; completados: number; piezas: number; vencian: number; a_tiempo: number; a_tiempo_vigente: number }

export interface Arrastre {
  requerimiento_id: string; titulo: string; cliente: string; owner: string | null; veces_reprogramado: number;
  fecha_original: string | null; fecha_actual: string | null; dias_arrastre: number; estado: string;
}

export interface Dashboard {
  generado_at: string;
  mesa: { id: string; nombre: string } | null;
  kpis: DashboardKpis;
  por_cliente: FilaCliente[];
  por_persona: FilaPersona[];
  por_estado: { estado: string; n: number }[];
  ultimas_8_semanas: SerieSemana[];
  arrastre: Arrastre[];
}

const dias = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000);

async function completadosDesde(ctx: DbCtx, desdeIso: string, mesa?: { clienteIds: string[]; proyectoIds: string[] }): Promise<RequerimientoMetricas[]> {
  let q = ctx.db.from('v_requerimientos_metricas').select('*').eq('tenant_id', ctx.tenantId).eq('estado_operativo', 'completado').gte('completado_at', desdeIso);
  if (mesa) {
    const partes: string[] = [];
    if (mesa.clienteIds.length) partes.push(`cliente_id.in.(${mesa.clienteIds.join(',')})`);
    if (mesa.proyectoIds.length) partes.push(`proyecto_id.in.(${mesa.proyectoIds.join(',')})`);
    if (!partes.length) return [];
    q = q.or(partes.join(','));
  }
  const { data, error } = await q;
  throwIf(error);
  return ((data ?? []) as RequerimientoMetricas[]).map((r) => ({ ...r, peso: Number(r.peso) }));
}

export async function buildDashboard(ctx: DbCtx, mesaId?: string | null): Promise<Dashboard> {
  const hoy = fechaLocal();
  const lunes = lunesDe(hoy);
  const hace30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const hace56 = new Date(Date.now() - 56 * 86_400_000).toISOString();

  const [mesas, usuarios, clientes, proyectos] = await Promise.all([listMesas(ctx), listUsuarios(ctx), listClientes(ctx, { incluirInactivos: true }), listProyectos(ctx)]);
  const mesa = mesaId ? mesas.find((m) => m.id === mesaId) ?? null : null;
  const alcance = mesa ? await alcanceMesa(ctx, mesa.id) : undefined;
  const [activos, completados56, horas, cumpl] = await Promise.all([listBacklog(ctx, { solo_activos: true, mesa: alcance }), completadosDesde(ctx, hace56, alcance), resumenHoras(ctx, hace30, alcance ? { clienteIds: alcance.clienteIds } : {}), listCumplimientoDesde(ctx, hace30)]);
  const { count: huerfanosPend } = await ctx.db.from('basecamp_huerfanos').select('id', { count: 'exact', head: true }).eq('tenant_id', ctx.tenantId).is('resuelto_at', null);
  const completados30 = completados56.filter((r) => r.completado_at && r.completado_at >= hace30);
  // Reprogramaciones/reprocesos 30d acotados al alcance (por requerimiento visible en activos o completados).
  const reqIdsAlcance = new Set([...activos, ...completados56].map((r) => r.id));
  const reqPorId = new Map([...activos, ...completados56].map((r) => [r.id, r]));
  const reprogs30 = cumpl.reprogramaciones.filter((x) => reqIdsAlcance.has(x.requerimiento_id));
  const reprocs30 = cumpl.reprocesos.filter((x) => reqIdsAlcance.has(x.requerimiento_id));
  const cumplTotal = resumirCumplimiento(completados30, reprogs30, reprocs30);

  const nombreU = (id?: string) => usuarios.find((u) => u.id === id)?.nombre ?? null;
  const clienteDe = (id: string) => clientes.find((c) => c.id === id);
  const mesaDe = (c?: Cliente) => (c?.mesa_id ? mesas.find((m) => m.id === c.mesa_id)?.nombre ?? null : null);
  const proyectosAlcance = alcance ? proyectos.filter((p) => alcance.proyectoIds.includes(p.id)) : proyectos;
  const proyectosActivos = proyectosAlcance.filter((p) => !['completado', 'cancelado'].includes(p.estado));

  const kpis: DashboardKpis = {
    activos: activos.length,
    atrasados: activos.filter((r) => r.dias_atraso > 0).length,
    sin_movimiento_14: activos.filter((r) => r.dias_sin_movimiento > 14).length,
    esperando_cliente: activos.filter((r) => r.estado_aprobacion === 'pendiente_cliente').length,
    bloqueados: activos.filter((r) => r.estado_operativo === 'bloqueado').length,
    reprogramados_2mas: activos.filter((r) => r.veces_reprogramado >= 2).length,
    completados_30d: completados30.length,
    piezas_completadas_30d: completados30.reduce((s, r) => s + (r.piezas || 0), 0),
    piezas_activas: activos.reduce((s, r) => s + (r.piezas || 0), 0),
    proyectos_activos: proyectosActivos.length,
    avance_promedio: proyectosActivos.length ? Math.round(proyectosActivos.reduce((s, p) => s + p.avance, 0) / proyectosActivos.length) : 0,
    horas_30d: horas.total,
    huerfanos_pendientes: huerfanosPend ?? 0,
    pct_a_tiempo_original_30d: cumplTotal.pct_original,
    pct_a_tiempo_vigente_30d: cumplTotal.pct_vigente,
    reprogramaciones_30d: cumplTotal.reprogramaciones,
    reprocesos_30d: cumplTotal.reprocesos,
    horas_reproceso_30d: cumplTotal.horas_reproceso,
  };

  const clientesIds = [...new Set([...activos.map((r) => r.cliente_id), ...completados30.map((r) => r.cliente_id), ...proyectosActivos.map((p) => p.cliente_id)])];
  const por_cliente: FilaCliente[] = clientesIds.map((id) => {
    const c = clienteDe(id);
    const act = activos.filter((r) => r.cliente_id === id);
    const comp = completados30.filter((r) => r.cliente_id === id);
    const proys = proyectosActivos.filter((p) => p.cliente_id === id);
    const atrasados = act.filter((r) => r.dias_atraso > 0).length;
    const sinMov = act.length ? Math.max(...act.map((r) => r.dias_sin_movimiento)) : 0;
    const salud: FilaCliente['salud'] = atrasados > 2 || sinMov > 14 || act.some((r) => r.dias_atraso > 30) ? 'rojo' : atrasados > 0 || sinMov > 7 ? 'amarillo' : 'verde';
    return {
      cliente_id: id, cliente: c?.nombre ?? id, mesa: mesaDe(c),
      activos: act.length, atrasados, esperando_cliente: act.filter((r) => r.estado_aprobacion === 'pendiente_cliente').length,
      sin_movimiento_max: sinMov, completados_30d: comp.length, piezas_activas: act.reduce((s, r) => s + (r.piezas || 0), 0),
      proyectos: proys.length, avance_promedio: proys.length ? Math.round(proys.reduce((s, p) => s + p.avance, 0) / proys.length) : 0, salud,
      horas_30d: horas.por_cliente[id] ?? 0, valor_cotizado_activo: proys.reduce((s, p) => s + (Number(p.valor_cotizado) || 0), 0),
      pct_a_tiempo_original_30d: resumirCumplimiento(comp, [], []).pct_original,
      reprocesos_30d: reprocs30.filter((x) => reqPorId.get(x.requerimiento_id)?.cliente_id === id).length,
      reprogramaciones_30d: reprogs30.filter((x) => reqPorId.get(x.requerimiento_id)?.cliente_id === id).length,
    };
  }).sort((a, b) => (a.salud === b.salud ? b.activos - a.activos : ['rojo', 'amarillo', 'verde'].indexOf(a.salud) - ['rojo', 'amarillo', 'verde'].indexOf(b.salud)));

  const finSemana = new Date(`${lunes}T12:00:00Z`); finSemana.setUTCDate(finSemana.getUTCDate() + 6);
  const finSemanaIso = finSemana.toISOString().slice(0, 10);
  const por_persona: FilaPersona[] = usuarios.filter((u) => u.activo).map((u) => {
    const mios = activos.filter((r) => r.owner_agencia.includes(u.id));
    const semana = mios.filter((r) => r.fecha_entrega && r.fecha_entrega >= lunes && r.fecha_entrega <= finSemanaIso);
    const totalSemana = activos.filter((r) => r.fecha_entrega && r.fecha_entrega >= lunes && r.fecha_entrega <= finSemanaIso).length || 1;
    const entregados = completados30.filter((r) => r.owner_agencia.includes(u.id));
    const esMio = (id: string) => reqPorId.get(id)?.owner_agencia.includes(u.id) ?? false;
    const cu = resumirCumplimiento(entregados, reprogs30.filter((x) => esMio(x.requerimiento_id)), reprocs30.filter((x) => esMio(x.requerimiento_id)));
    return {
      usuario_id: u.id, nombre: u.nombre, activos: mios.length, semana_actual: semana.length, atrasados: mios.filter((r) => r.dias_atraso > 0).length, capacidad_semanal: u.capacidad_semanal, pct_semana: Math.round((semana.length / totalSemana) * 100), horas_30d: horas.por_usuario[u.id] ?? 0,
      entregados_30d: entregados.length, pct_a_tiempo_original_30d: cu.pct_original, pct_a_tiempo_vigente_30d: cu.pct_vigente, desvio_mediana_dias: cu.desvio_mediana_dias,
      reprogramaciones_equipo_30d: cu.reprogramaciones_equipo, reprocesos_30d: cu.reprocesos,
      motivo_reprogramacion_dominante: cu.motivo_reprogramacion_dominante ? labelMotivoReprogramacion(cu.motivo_reprogramacion_dominante as never) : null,
      motivo_reproceso_dominante: cu.motivo_reproceso_dominante ? labelMotivoReproceso(cu.motivo_reproceso_dominante as never) : null,
    };
  }).filter((p) => p.activos > 0 || p.horas_30d > 0 || p.entregados_30d > 0).sort((a, b) => b.activos - a.activos);

  const por_estado = ['backlog', 'priorizado', 'en_ejecucion', 'en_revision', 'bloqueado', 'reprogramado'].map((estado) => ({ estado, n: activos.filter((r) => r.estado_operativo === estado).length }));

  // Últimas 8 semanas: completados y piezas por semana de completado; a tiempo = completado <= fecha_entrega.
  const semanas: SerieSemana[] = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date(`${lunes}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 7 * i);
    const ini = d.toISOString().slice(0, 10);
    const fin = new Date(d); fin.setUTCDate(fin.getUTCDate() + 6);
    const finIso = fin.toISOString().slice(0, 10);
    const comp = completados56.filter((r) => r.completado_at && r.completado_at.slice(0, 10) >= ini && r.completado_at.slice(0, 10) <= finIso);
    const vencian = [...activos, ...completados56].filter((r) => r.fecha_entrega && r.fecha_entrega >= ini && r.fecha_entrega <= finIso);
    semanas.push({
      semana_inicio: ini,
      completados: comp.length,
      piezas: comp.reduce((s, r) => s + (r.piezas || 0), 0),
      vencian: vencian.length,
      a_tiempo: vencian.filter((r) => r.estado_operativo === 'completado' && r.completado_at && r.fecha_entrega_original && r.completado_at.slice(0, 10) <= r.fecha_entrega_original).length,
      a_tiempo_vigente: vencian.filter((r) => r.estado_operativo === 'completado' && r.completado_at && r.completado_at.slice(0, 10) <= (r.fecha_entrega as string)).length,
    });
  }

  const arrastre: Arrastre[] = activos
    .filter((r) => r.veces_reprogramado > 0 || r.dias_atraso > 0)
    .map((r) => ({
      requerimiento_id: r.id, titulo: r.titulo_interno, cliente: clienteDe(r.cliente_id)?.nombre ?? '', owner: nombreU(r.owner_agencia[0]),
      veces_reprogramado: r.veces_reprogramado, fecha_original: r.fecha_entrega_original, fecha_actual: r.fecha_entrega,
      dias_arrastre: r.fecha_entrega_original && r.fecha_entrega ? Math.max(0, dias(r.fecha_entrega_original, r.fecha_entrega)) + Math.max(0, r.dias_atraso) : r.dias_atraso,
      estado: r.estado_operativo,
    }))
    .sort((a, b) => b.veces_reprogramado - a.veces_reprogramado || b.dias_arrastre - a.dias_arrastre)
    .slice(0, 50);

  return { generado_at: new Date().toISOString(), mesa: mesa ? { id: mesa.id, nombre: mesa.nombre } : null, kpis, por_cliente, por_persona, por_estado, ultimas_8_semanas: semanas, arrastre };
}
export type { Proyecto, Usuario, Mesa, Semana };
