/**
 * Orquestación de rituales sobre la base: arma el WeekContext, corre el motor,
 * persiste señales y genera documentos.
 */
import type { DbCtx } from '../db/client';
import { listBacklog } from '../db/requerimientos';
import { listUsuarios } from '../db/usuarios';
import { listClientes, idsClientesDePrueba } from '../db/clientes';
import { getMesa, alcanceMesa } from '../db/mesas';
import {
  atendidaVigente,
  atendidasRecientes,
  ensureSemana,
  getSemana,
  insertActa,
  listAcuerdosAbiertos,
  listAcuerdosSemana,
  listSenales,
  replaceSenales,
} from '../db/semanas';
import { listSinMotivo } from '../db/historial';
import { calcularSenales } from './signals';
import { calcularCapacidad, renderActaCierre, renderPlanOperativo } from './documents';
import { getUmbralesSenales, listCompletadosRecientes } from '../db/rituales';
import type { Senal, Acta, Acuerdo, CapacidadPersona, Semana } from '@backio/shared';
import { hoyLocal, inicioDiaLocal, sumarDias, tramosEsperaCliente } from '@backio/shared';
import {
  calcularMarcador,
  fechaCompromiso,
  inicioTrimestre,
  lunesDe,
  SEMANAS_HISTORIAL,
  type Marcador,
  type ReprogramacionMarcador,
} from './marcador';
import { listReprogramacionesMarcador, listEventosAprobacion } from '../db/historial';
import { cargaDelEquipo } from '../carga';

/** Días enteros que cada tarea «pendiente del cliente» lleva esperando, según aprobacion_eventos. */
export async function diasEsperandoCliente(ctx: DbCtx, activos: { id: string; estado_aprobacion: string }[]): Promise<Map<string, number>> {
  const ids = activos.filter((r) => r.estado_aprobacion === 'pendiente_cliente').map((r) => r.id);
  if (!ids.length) return new Map();
  const tramos = tramosEsperaCliente(await listEventosAprobacion(ctx, ids));
  return new Map(tramos.filter((t) => t.hasta === null).map((t) => [t.requerimiento_id, Math.floor(t.dias)]));
}

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
    esperaCliente: await diasEsperandoCliente(ctx, activos),
    carga: await cargaDelEquipo(ctx, semana, hoy),
  });
  return replaceSenales(ctx, semana.id, senales);
}

/** Capacidad de la semana; con mesa, solo con sus clientes y proyectos (sin clientes de prueba), igual que el plan. */
export async function capacidadSemana(ctx: DbCtx, semanaId: string, mesaId?: string | null): Promise<CapacidadPersona[]> {
  const semana = await getSemana(ctx, semanaId);
  if (!semana) throw new Error('Semana no encontrada');
  const { alcance } = await filtroMesa(ctx, mesaId);
  const [reqs, usuarios, prueba] = await Promise.all([
    listBacklog(ctx, { solo_activos: true, desde: semana.fecha_inicio, hasta: semana.fecha_fin, mesa: alcance }),
    listUsuarios(ctx, { incluirInactivos: true }),
    idsClientesDePrueba(ctx),
  ]);
  const base = calcularCapacidad(
    reqs.filter((r) => !prueba.has(r.cliente_id)),
    usuarios,
  );
  // Horas estimadas y tareas en riesgo: la carga de la persona en todas sus mesas, contra lo que le queda de la semana.
  const carga = new Map((await cargaDelEquipo(ctx, semana)).map((c) => [c.usuario_id, c]));
  return base.map((c) => {
    const k = carga.get(c.usuario_id);
    return k
      ? {
          ...c,
          horas_estimadas: k.horas,
          capacidad_restante: k.capacidad_restante,
          capacidad_base: k.capacidad_base,
          en_riesgo: k.en_riesgo.map(({ id, titulo, cliente_id, fecha_entrega, horas }) => ({
            id,
            titulo,
            cliente_id,
            fecha_entrega,
            horas,
          })),
        }
      : c;
  });
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
  const alcance = await alcanceMesa(ctx, mesaId, { sinPrueba: true });
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
    acuerdosAbiertos: acuerdosDeLaMesa(acuerdos, mesaId),
    umbrales: u,
    sinMotivo,
    esperaCliente: await diasEsperandoCliente(ctx, activos),
    // La carga de cada persona incluye todas sus mesas; la señal sale en la mesa donde tiene tareas en riesgo.
    carga: (await cargaDelEquipo(ctx, semana)).filter((c) => c.en_riesgo.some((t) => deLaMesa.some((r) => r.id === t.id))),
  });
  const previa = new Map(guardadas.map((s) => [`${s.tipo}|${s.entidad_id}`, s]));
  const atendidas = await atendidasRecientes(ctx);
  return calculadas.map((s, i) => {
    const g = previa.get(`${s.tipo}|${s.entidad_id}`);
    // Atendida esta semana o la anterior, sin haber empeorado (migración 35).
    const a = g?.atendida ? g : atendidaVigente(atendidas, s);
    return {
      ...s,
      id: g?.id ?? `mesa-${i}`,
      tenant_id: ctx.tenantId,
      semana_id: semana.id,
      atendida: !!a,
      atendida_por: a?.atendida_por ?? null,
      atendida_at: a?.atendida_at ?? null,
      created_at: g?.created_at ?? new Date().toISOString(),
    };
  });
}

/**
 * Acuerdos que van en el weekly de una mesa: los que se acordaron en esa mesa (`acuerdos.mesa_id`, migración 35). Antes
 * se adivinaba por las tareas del responsable: quien trabaja en dos mesas veía su acuerdo en las dos actas, y el de
 * alguien sin tareas en la mesa no salía en ninguna.
 */
export function acuerdosDeLaMesa<A extends Pick<Acuerdo, 'mesa_id'>>(acuerdos: A[], mesaId: string): A[] {
  return acuerdos.filter((a) => a.mesa_id === mesaId);
}

/** Acuerdos abiertos que van en el weekly de una mesa (todos, si no hay mesa). */
export async function acuerdosAbiertosDeMesa(ctx: DbCtx, mesaId?: string | null): Promise<Acuerdo[]> {
  const abiertos = await listAcuerdosAbiertos(ctx);
  return mesaId ? acuerdosDeLaMesa(abiertos, mesaId) : abiertos;
}

async function filtroMesa(ctx: DbCtx, mesaId?: string | null) {
  if (!mesaId) return { mesa: null, alcance: undefined };
  const mesa = await getMesa(ctx, mesaId);
  if (!mesa) throw new Error('Mesa no encontrada');
  return { mesa, alcance: await alcanceMesa(ctx, mesaId, { sinPrueba: true }) };
}

/**
 * Marcador de la mesa: tareas de la mesa con entrega desde el inicio del historial (trimestre o 16 semanas) hasta el fin
 * de la semana, sin clientes de prueba. Se trae de a 4 semanas para no chocar con el tope de filas de la API.
 */
export async function marcadorDeMesa(
  ctx: DbCtx,
  semana: Semana,
  alcance: Awaited<ReturnType<typeof alcanceMesa>> | undefined,
  prueba: Set<string>,
  cierre: boolean,
): Promise<Marcador | undefined> {
  if (!alcance) return undefined;
  const inicio = lunesDe(semana.fecha_inicio);
  const desde = lunesDe([inicioTrimestre(inicio), sumarDias(inicio, -7 * SEMANAS_HISTORIAL)].sort()[0]!);
  const tramos: [string, string][] = [];
  for (let s = desde; s <= inicio; s = sumarDias(s, 28)) tramos.push([s, [sumarDias(s, 27), sumarDias(inicio, 6)].sort()[0]!]);
  // Por fecha vigente y por fecha original: una tarea reprogramada fuera de la ventana sigue contando en su semana.
  const [vigentes, originales, reprogs] = await Promise.all([
    Promise.all(tramos.map(([d, h]) => listBacklog(ctx, { desde: d, hasta: h, mesa: alcance }))),
    Promise.all(tramos.map(([d, h]) => listBacklog(ctx, { original_desde: d, original_hasta: h, mesa: alcance }))),
    listReprogramacionesMarcador(ctx, inicioDiaLocal(sumarDias(desde, -180))),
  ]);
  const porId = new Map([...vigentes.flat(), ...originales.flat()].map((r) => [r.id, r]));
  const porTarea = new Map<string, ReprogramacionMarcador[]>();
  for (const r of reprogs) porTarea.set(r.requerimiento_id, [...(porTarea.get(r.requerimiento_id) ?? []), r]);
  const tareas = [...porId.values()]
    .filter((r) => !prueba.has(r.cliente_id))
    .map((r) => ({ ...r, fecha_compromiso: fechaCompromiso(r, porTarea.get(r.id) ?? []) }));
  return calcularMarcador(tareas, inicio, { cierre });
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
  const pendientes = mesa ? acuerdosDeLaMesa(pendientesTodos, mesa.id) : pendientesTodos;
  const marcador = await marcadorDeMesa(ctx, semana, alcance, prueba, false);
  const data = {
    semana,
    mesa: mesa?.nombre ?? null,
    ...(marcador ? { marcador } : {}),
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
  const [prioridadesTodas, usuarios, clientes, pendientesTodos, senales, acuerdosTodos, prueba] = await Promise.all([
    listBacklog(ctx, { desde: semana.fecha_inicio, hasta: semana.fecha_fin, mesa: alcance }),
    listUsuarios(ctx, { incluirInactivos: true }),
    listClientes(ctx),
    listAcuerdosAbiertos(ctx),
    senalesDeMesa(ctx, semana, mesa?.id ?? null),
    listAcuerdosSemana(ctx, semanaId),
    idsClientesDePrueba(ctx),
  ]);
  const prioridades = prioridadesTodas.filter((r) => !prueba.has(r.cliente_id));
  const pendientes = mesa ? acuerdosDeLaMesa(pendientesTodos, mesa.id) : pendientesTodos;
  const acuerdos = mesa ? acuerdosDeLaMesa(acuerdosTodos, mesa.id) : acuerdosTodos;
  const marcador = await marcadorDeMesa(ctx, semana, alcance, prueba, true);
  const data = {
    semana,
    mesa: mesa?.nombre ?? null,
    ...(marcador ? { marcador } : {}),
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
