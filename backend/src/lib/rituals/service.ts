/**
 * Orquestación de rituales sobre la base: arma el WeekContext, corre el motor,
 * persiste señales y genera documentos.
 */
import type { DbCtx } from '../db/client';
import { listBacklog } from '../db/requerimientos';
import { listUsuarios } from '../db/usuarios';
import { listClientes, idsClientesDePrueba } from '../db/clientes';
import { getMesa, alcanceMesa } from '../db/mesas';
import { ensureSemana, getSemana, listAcuerdosAbiertos, listAcuerdosSemana, listSenales, replaceSenales, insertActa } from '../db/semanas';
import { listSinMotivo } from '../db/historial';
import { calcularSenales } from './signals';
import { calcularCapacidad, renderActaCierre, renderPlanOperativo } from './documents';
import { getUmbralesSenales, listCompletadosRecientes } from '../db/rituales';
import type { Senal, Acta, Acuerdo, CapacidadPersona, Semana } from '@backio/shared';
import { hoyLocal } from '@backio/shared';

export async function recalcularSenales(ctx: DbCtx, semanaId?: string): Promise<Senal[]> {
  const hoy = hoyLocal();
  const semana = semanaId ? await getSemana(ctx, semanaId) : await ensureSemana(ctx, hoy);
  if (!semana) throw new Error('Semana no encontrada');
  const [activos, usuarios, clientes, acuerdosAbiertos, u, sinMotivo] = await Promise.all([
    listBacklog(ctx, { solo_activos: true }),
    listUsuarios(ctx, { incluirInactivos: true }),
    listClientes(ctx),
    listAcuerdosAbiertos(ctx),
    getUmbralesSenales(ctx),
    listSinMotivo(ctx, 45),
  ]);
  const completados = await listCompletadosRecientes(ctx, new Date(Date.now() - 30 * 86_400_000).toISOString());
  // Los clientes de prueba (migración 34) no generan señales.
  const prueba = await idsClientesDePrueba(ctx);
  const senales = calcularSenales({
    hoy,
    semana: { fecha_inicio: semana.fecha_inicio, fecha_fin: semana.fecha_fin },
    activos: activos.filter((r) => !prueba.has(r.cliente_id)),
    completadosRecientes: completados as { cliente_id: string; completado_at: string | null }[],
    usuarios,
    clientes,
    acuerdosAbiertos,
    umbrales: u,
    sinMotivo,
  });
  return replaceSenales(ctx, semana.id, senales);
}

export async function capacidadSemana(ctx: DbCtx, semanaId: string): Promise<CapacidadPersona[]> {
  const semana = await getSemana(ctx, semanaId);
  if (!semana) throw new Error('Semana no encontrada');
  const [reqs, usuarios] = await Promise.all([
    listBacklog(ctx, { solo_activos: true, desde: semana.fecha_inicio, hasta: semana.fecha_fin }),
    listUsuarios(ctx, { incluirInactivos: true }),
  ]);
  return calcularCapacidad(reqs, usuarios);
}

/** Inserta la narrativa de la IA después del título del documento. */
function conNarrativa(md: string, narrativa?: string): string {
  if (!narrativa) return md;
  const [titulo, ...resto] = md.split('\n');
  return [titulo, '', narrativa.trim(), '', ...resto].join('\n');
}

/**
 * Señales de una mesa, calculadas solo con sus clientes y proyectos. Antes las actas y el weekly de una mesa tomaban
 * las señales guardadas de toda la agencia: en el cierre de Omega aparecían AB-Inbev (Orión) y Acme (prueba)
 * (19/10/2026). Respeta las que ya se marcaron como atendidas. Sin mesa, son las guardadas de la semana.
 */
export async function senalesDeMesa(ctx: DbCtx, semana: Semana, mesaId?: string | null): Promise<Senal[]> {
  const guardadas = await listSenales(ctx, semana.id);
  if (!mesaId) return guardadas;
  const alcance = await alcanceMesa(ctx, mesaId);
  const [activos, usuarios, clientes, acuerdos, u, sinMotivo, prueba] = await Promise.all([
    listBacklog(ctx, { solo_activos: true, mesa: alcance }),
    listUsuarios(ctx, { incluirInactivos: true }),
    listClientes(ctx),
    listAcuerdosAbiertos(ctx),
    getUmbralesSenales(ctx),
    listSinMotivo(ctx, 45),
    idsClientesDePrueba(ctx),
  ]);
  const deLaMesa = activos.filter((r) => !prueba.has(r.cliente_id));
  const completados = await listCompletadosRecientes(ctx, new Date(Date.now() - 30 * 86_400_000).toISOString());
  const calculadas = calcularSenales({
    hoy: hoyLocal(),
    semana: { fecha_inicio: semana.fecha_inicio, fecha_fin: semana.fecha_fin },
    activos: deLaMesa,
    completadosRecientes: completados as { cliente_id: string; completado_at: string | null }[],
    usuarios,
    clientes,
    acuerdosAbiertos: acuerdosDeLaMesa(acuerdos, personasDeLaMesa(deLaMesa)),
    umbrales: u,
    sinMotivo,
  });
  const previa = new Map(guardadas.map((s) => [`${s.tipo}|${s.entidad_id}`, s]));
  return calculadas.map((s, i) => {
    const g = previa.get(`${s.tipo}|${s.entidad_id}`);
    return {
      ...s,
      id: g?.id ?? `mesa-${i}`,
      tenant_id: ctx.tenantId,
      semana_id: semana.id,
      atendida: g?.atendida ?? false,
      created_at: g?.created_at ?? new Date().toISOString(),
    };
  });
}

/** Quienes trabajan en la mesa: responsables de sus tareas activas. */
function personasDeLaMesa(activos: { owner_agencia: string[] }[]): Set<string> {
  return new Set(activos.flatMap((r) => r.owner_agencia));
}

/**
 * Los acuerdos del weekly no tienen mesa: en el documento de una mesa entran los de quienes trabajan en ella.
 */
function acuerdosDeLaMesa<A extends Pick<Acuerdo, 'responsable_id'>>(acuerdos: A[], personas: Set<string>): A[] {
  return acuerdos.filter((a) => personas.has(a.responsable_id));
}

/** Acuerdos abiertos que van en el weekly de una mesa (todos, si no hay mesa). */
export async function acuerdosAbiertosDeMesa(ctx: DbCtx, mesaId?: string | null): Promise<Acuerdo[]> {
  const abiertos = await listAcuerdosAbiertos(ctx);
  if (!mesaId) return abiertos;
  const activos = await listBacklog(ctx, { solo_activos: true, mesa: await alcanceMesa(ctx, mesaId) });
  return acuerdosDeLaMesa(abiertos, personasDeLaMesa(activos));
}

async function filtroMesa(ctx: DbCtx, mesaId?: string | null) {
  if (!mesaId) return { mesa: null, alcance: undefined };
  const mesa = await getMesa(ctx, mesaId);
  if (!mesa) throw new Error('Mesa no encontrada');
  return { mesa, alcance: await alcanceMesa(ctx, mesaId) };
}

export async function generarPlanOperativo(ctx: DbCtx, semanaId: string, mesaId?: string | null, narrativa?: string): Promise<Acta> {
  const semana = await getSemana(ctx, semanaId);
  if (!semana) throw new Error('Semana no encontrada');
  const { mesa, alcance } = await filtroMesa(ctx, mesaId);
  const [prioridadesTodas, usuarios, clientes, pendientesTodos, senales, prueba] = await Promise.all([
    listBacklog(ctx, { solo_activos: true, desde: semana.fecha_inicio, hasta: semana.fecha_fin, mesa: alcance }),
    listUsuarios(ctx, { incluirInactivos: true }),
    listClientes(ctx),
    listAcuerdosAbiertos(ctx),
    senalesDeMesa(ctx, semana, mesa?.id ?? null),
    idsClientesDePrueba(ctx),
  ]);
  const prioridades = prioridadesTodas.filter((r) => !prueba.has(r.cliente_id));
  const riesgos = senales.filter((s) => ['bloqueo_cliente', 'sobrecarga_proyectada', 'concentracion_carga'].includes(s.tipo));
  const pendientes = mesa ? acuerdosDeLaMesa(pendientesTodos, personasDeLaMesa(prioridades)) : pendientesTodos;
  const data = {
    semana,
    mesa: mesa?.nombre ?? null,
    capacidad: calcularCapacidad(prioridades, usuarios),
    prioridades,
    riesgos,
    pendientes_anteriores: pendientes,
    usuarios,
    clientes,
  };
  return insertActa(ctx, {
    semana_id: semanaId,
    tipo: 'plan_operativo',
    mesa_id: mesa?.id ?? null,
    contenido: data,
    markdown: conNarrativa(renderPlanOperativo(data), narrativa),
  });
}

export async function generarActaCierre(ctx: DbCtx, semanaId: string, mesaId?: string | null, narrativa?: string): Promise<Acta> {
  const semana = await getSemana(ctx, semanaId);
  if (!semana) throw new Error('Semana no encontrada');
  const { mesa, alcance } = await filtroMesa(ctx, mesaId);
  const [prioridadesTodas, usuarios, clientes, pendientesTodos, senales, acuerdosTodos, prueba, activosMesa] = await Promise.all([
    listBacklog(ctx, { desde: semana.fecha_inicio, hasta: semana.fecha_fin, mesa: alcance }),
    listUsuarios(ctx, { incluirInactivos: true }),
    listClientes(ctx),
    listAcuerdosAbiertos(ctx),
    senalesDeMesa(ctx, semana, mesa?.id ?? null),
    listAcuerdosSemana(ctx, semanaId),
    idsClientesDePrueba(ctx),
    alcance ? listBacklog(ctx, { solo_activos: true, mesa: alcance }) : Promise.resolve([]),
  ]);
  const prioridades = prioridadesTodas.filter((r) => !prueba.has(r.cliente_id));
  const personas = personasDeLaMesa([...prioridades, ...activosMesa]);
  const pendientes = mesa ? acuerdosDeLaMesa(pendientesTodos, personas) : pendientesTodos;
  const acuerdos = mesa ? acuerdosDeLaMesa(acuerdosTodos, personas) : acuerdosTodos;
  const data = {
    semana,
    mesa: mesa?.nombre ?? null,
    capacidad: calcularCapacidad(prioridades, usuarios),
    prioridades,
    riesgos: [],
    pendientes_anteriores: pendientes,
    usuarios,
    clientes,
    senales,
    acuerdos_semana: acuerdos,
  };
  return insertActa(ctx, {
    semana_id: semanaId,
    tipo: 'cierre',
    mesa_id: mesa?.id ?? null,
    contenido: data,
    markdown: conNarrativa(renderActaCierre(data), narrativa),
  });
}
