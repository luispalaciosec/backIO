/**
 * Ficha de cliente (docs/21): ejecutiva y mesa, salud con su porqué, indicadores de entrega, proyectos, tareas por
 * atender, últimas entregas y señales. Reutiliza las mismas piezas que el dashboard (saludCliente, resumirCumplimiento,
 * resumenHoras), así ambos dicen lo mismo.
 */
import type { FichaCliente, PersonaFicha, RequerimientoMetricas, TareaFicha, Usuario } from '@backio/shared';
import {
  MOTIVOS_REPROGRAMACION,
  SALUD_DIAS_ENTREGAS,
  diaLocal,
  hoyLocal,
  nombrePersona,
  reprocesoDelEquipo,
  saludCliente,
  operacionParaSalud,
  esTrabajoMedido,
} from '@backio/shared';
import type { DbCtx } from '../db/client';
import { getCliente } from '../db/clientes';
import { getMesa } from '../db/mesas';
import { listUsuarios } from '../db/usuarios';
import { listProyectos } from '../db/proyectos';
import { listBacklog } from '../db/requerimientos';
import { listCompletadosDesde } from '../db/dashboard';
import { listCumplimientoDesde } from '../db/historial';
import { ensureSemana, listSenales } from '../db/semanas';
import { aTiempoOriginal, labelMotivoReproceso, labelMotivoReprogramacion, resumirCumplimiento } from '../cumplimiento';
import { resumenHoras } from '../horas';

const DIA = 86_400_000;
const MESES = 6;
/** Más de esto sin movimiento: va a «Sin movimiento» en la ficha. */
const SIN_MOVIMIENTO_DIAS = 7;

const persona = (u: Usuario | undefined): PersonaFicha | null =>
  u ? { id: u.id, nombre: nombrePersona(u), avatar_url: u.avatar_url, email: u.email ?? null } : null;

/** Primer día (YYYY-MM-01) de hace `n` meses respecto del mes de `hoy`. */
function mesAtras(hoy: string, n: number): string {
  const [y, m] = hoy.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return d.toISOString().slice(0, 7);
}

export async function fichaCliente(ctx: DbCtx, clienteId: string, ahora = new Date()): Promise<FichaCliente | null> {
  const cliente = await getCliente(ctx, clienteId);
  if (!cliente) return null;
  const hoy = hoyLocal(ahora);
  const hace30 = new Date(ahora.getTime() - 30 * DIA).toISOString();
  const hace90 = new Date(ahora.getTime() - SALUD_DIAS_ENTREGAS * DIA).toISOString();
  const primerMes = mesAtras(hoy, MESES - 1);
  const desdeMensual = new Date(`${primerMes}-01T00:00:00-05:00`).toISOString();
  const desde = desdeMensual < hace90 ? desdeMensual : hace90;
  const alcance = { clienteIds: [clienteId], proyectoIds: [] };

  const [usuarios, mesa, proyectos, activos, completados, cumpl, horas, semana] = await Promise.all([
    listUsuarios(ctx, { incluirInactivos: true }),
    cliente.mesa_id ? getMesa(ctx, cliente.mesa_id) : Promise.resolve(null),
    listProyectos(ctx, { cliente_id: clienteId }),
    listBacklog(ctx, { cliente_id: clienteId, solo_activos: true }),
    listCompletadosDesde(ctx, desde, alcance),
    listCumplimientoDesde(ctx, desde),
    resumenHoras(ctx, hace30, { clienteIds: [clienteId] }),
    ensureSemana(ctx, hoy),
  ]);
  const senalesSemana = await listSenales(ctx, semana.id);

  const u = (id: string | null | undefined) => (id ? usuarios.find((x) => x.id === id) : undefined);
  const nombreProyecto = new Map(proyectos.map((p) => [p.id, p.nombre]));
  const tarea = (r: RequerimientoMetricas): TareaFicha => ({
    id: r.id,
    titulo_interno: r.titulo_interno,
    proyecto: r.proyecto_id ? (nombreProyecto.get(r.proyecto_id) ?? null) : null,
    responsables: r.owner_agencia.map((id) => (u(id) ? nombrePersona(u(id)!) : '—')),
    estado_operativo: r.estado_operativo,
    esperando_cliente: r.estado_aprobacion === 'pendiente_cliente',
    fecha_entrega: r.fecha_entrega,
    dias_atraso: r.dias_atraso,
    dias_sin_movimiento: r.dias_sin_movimiento,
    completado_at: r.completado_at,
    a_tiempo: r.estado_operativo === 'completado' ? aTiempoOriginal(r) : null,
    basecamp_url: r.basecamp_url,
  });

  const ids = new Set([...activos, ...completados].map((r) => r.id));
  const reprogs = cumpl.reprogramaciones.filter((x) => ids.has(x.requerimiento_id));
  const reprocs = cumpl.reprocesos.filter((x) => ids.has(x.requerimiento_id));
  const comp90 = completados.filter((r) => r.completado_at && r.completado_at >= hace90);
  const reprogs90 = reprogs.filter((x) => x.created_at >= hace90);
  const reprocs90 = reprocs.filter((x) => x.abierto_at >= hace90);
  // El % a tiempo mide solo lo pedido desde que se opera en BackIO; lo importado es historia (esTrabajoMedido).
  const medidas90 = comp90.filter(esTrabajoMedido);
  const c90 = resumirCumplimiento(medidas90, reprogs90, reprocs90);
  const reprocesosEquipo = reprocs90.filter(reprocesoDelEquipo).length;

  const atrasadas = activos.filter((r) => r.dias_atraso > 0).sort((a, b) => b.dias_atraso - a.dias_atraso);
  const sinMovMax = activos.length ? Math.max(...activos.map((r) => r.dias_sin_movimiento)) : 0;
  // Lo que espera al cliente no cuenta para la salud (operacionParaSalud): es una alerta para pedir el feedback.
  const salud = saludCliente({
    ...operacionParaSalud(activos),
    entregas: medidas90.length,
    pct_a_tiempo: c90.pct_original,
    reprocesos_equipo: reprocesosEquipo,
  });

  const mensual = Array.from({ length: MESES }, (_, i) => mesAtras(hoy, MESES - 1 - i)).map((mes) => {
    const delMes = completados.filter((r) => r.completado_at && diaLocal(r.completado_at).startsWith(mes));
    return {
      mes,
      entregas: delMes.length,
      pct_a_tiempo: resumirCumplimiento(delMes.filter(esTrabajoMedido), [], []).pct_original,
      reprocesos: reprocs.filter((x) => diaLocal(x.abierto_at).startsWith(mes)).length,
    };
  });

  // Señales de esta semana: las del cliente y las de sus tareas.
  const senales = senalesSemana.filter(
    (s) =>
      (s.entidad_tipo === 'cliente' && s.entidad_id === clienteId) ||
      (s.entidad_tipo === 'requerimiento' && (ids.has(s.entidad_id) || s.detalle?.cliente_id === clienteId)),
  );

  const lider = mesa ? persona(u(mesa.lider_id)) : null;
  return {
    cliente: {
      id: cliente.id,
      nombre: cliente.nombre,
      logo_url: cliente.logo_url,
      color_primario: cliente.color_primario,
      mesa_id: cliente.mesa_id,
      ejecutiva_id: cliente.ejecutiva_id ?? null,
      activo: cliente.activo,
    },
    mesa: mesa ? { id: mesa.id, nombre: mesa.nombre, lider } : null,
    ejecutiva: persona(u(cliente.ejecutiva_id)),
    salud,
    indicadores: {
      activos: activos.length,
      atrasados: atrasadas.length,
      esperando_cliente: activos.filter((r) => r.estado_aprobacion === 'pendiente_cliente').length,
      atrasados_esperando_cliente: atrasadas.filter((r) => r.estado_aprobacion === 'pendiente_cliente').length,
      bloqueadas: activos.filter((r) => r.estado_operativo === 'bloqueado').length,
      sin_movimiento_max: sinMovMax,
      entregas_90d: comp90.length,
      entregas_medidas_90d: medidas90.length,
      pct_a_tiempo_90d: c90.pct_original,
      pct_a_tiempo_vigente_90d: c90.pct_vigente,
      desvio_mediana_dias: c90.desvio_mediana_dias,
      reprocesos_90d: reprocs90.length,
      reprocesos_equipo_90d: reprocesosEquipo,
      reprogramaciones_90d: reprogs90.length,
      reprogramaciones_cliente_90d: reprogs90.filter(
        (x) => MOTIVOS_REPROGRAMACION.find((m) => m.valor === x.motivo)?.atribuible === 'cliente',
      ).length,
      motivo_reproceso_dominante: c90.motivo_reproceso_dominante ? labelMotivoReproceso(c90.motivo_reproceso_dominante as never) : null,
      motivo_reprogramacion_dominante: c90.motivo_reprogramacion_dominante
        ? labelMotivoReprogramacion(c90.motivo_reprogramacion_dominante as never)
        : null,
      horas_30d: horas.total,
    },
    mensual,
    proyectos: proyectos
      .map((p) => {
        const act = activos.filter((r) => r.proyecto_id === p.id);
        return {
          id: p.id,
          nombre: p.nombre,
          estado: p.estado,
          avance: p.avance,
          fecha_entrega: p.fecha_entrega,
          valor_cotizado: p.valor_cotizado === null || p.valor_cotizado === undefined ? null : Number(p.valor_cotizado),
          activos: act.length,
          atrasados: act.filter((r) => r.dias_atraso > 0).length,
          horas_30d: horas.por_proyecto[p.id] ?? 0,
        };
      })
      // Primero lo que está en curso y tiene trabajo abierto.
      .sort(
        (a, b) =>
          Number(['completado', 'cancelado'].includes(a.estado)) - Number(['completado', 'cancelado'].includes(b.estado)) ||
          b.atrasados - a.atrasados ||
          b.activos - a.activos ||
          a.nombre.localeCompare(b.nombre, 'es'),
      ),
    tareas: {
      atrasadas: atrasadas.slice(0, 20).map(tarea),
      // Lo que más tiempo lleva esperando, primero: es lo que la ejecutiva tiene que empujar.
      esperando_cliente: activos
        .filter((r) => r.estado_aprobacion === 'pendiente_cliente')
        .sort((a, b) => b.dias_sin_movimiento - a.dias_sin_movimiento)
        .map(tarea),
      bloqueadas: activos.filter((r) => r.estado_operativo === 'bloqueado').map(tarea),
      sin_movimiento: activos
        .filter((r) => r.dias_sin_movimiento > SIN_MOVIMIENTO_DIAS && r.dias_atraso === 0)
        .sort((a, b) => b.dias_sin_movimiento - a.dias_sin_movimiento)
        .slice(0, 20)
        .map(tarea),
      ultimas_completadas: [...completados]
        .sort((a, b) => (b.completado_at ?? '').localeCompare(a.completado_at ?? ''))
        .slice(0, 10)
        .map(tarea),
    },
    senales,
  };
}
