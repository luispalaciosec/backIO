/**
 * Escenarios para armar el día (docs/05): tres formas de elegir las tareas de hoy, ajustadas a las horas de cada persona.
 * Las reglas deciden qué se sugiere y cuál se recomienda; la IA, si se le pide, solo explica. Nada se marca sin un clic.
 *
 * Lo que nunca se sugiere: lo que espera al cliente, lo bloqueado, lo que no tiene responsable y lo atrasado y quieto, que
 * seguramente ya se entregó: 43 de las 77 atrasadas del 3/11/2026 llevaban más de 7 días sin moverse. Eso va aparte como
 * «¿Sigue viva?», para preguntarle a su responsable en lugar de recomendar trabajo que quizá ya está hecho.
 */
import type { RequerimientoMetricas, Salud } from '@backio/shared';
import { hoyLocal, sumarDias } from '@backio/shared';
import type { DbCtx } from '../db/client';
import { listBacklog } from '../db/requerimientos';
import { alcanceEjecutiva, alcanceMesa } from '../db/mesas';
import { idsClientesDePrueba } from '../db/clientes';
import { ultimaSaludPorCliente } from '../db/cliente_salud';
import { cargaDelDia, DIAS_ATRASADA_VIVA, type CargaDia } from '../carga';
import { metricasPorIds } from '../db/requerimientos';
import { listAcuerdosAbiertos } from '../db/semanas';
import { notificar } from '../notificaciones';

export type IdEscenario = 'sin_vencidos' | 'cuentas_riesgo' | 'mas_entregas';
export type Razon =
  | 'ya_elegida'
  | 'vence_hoy'
  | 'vence_manana'
  | 'atrasada'
  | 'del_ultimo_daily'
  | 'compromiso_weekly'
  | 'en_curso'
  | 'urgente'
  | 'cliente_rojo'
  | 'cliente_amarillo';

export interface TareaSugerida {
  id: string;
  razones: Razon[];
}
export interface ImpactoEscenario {
  tareas: number;
  nuevas: number;
  /** Atrasadas vivas (no las quietas): cuántas hay y cuántas quedarían sin atender. */
  atraso_antes: number;
  atraso_despues: number;
  vencen_hoy: number;
  vencen_hoy_cubiertas: number;
  /** Candidatas que no entran por falta de horas, por cliente. */
  afuera: number;
  afuera_por_cliente: { cliente_id: string; n: number }[];
  personas: { usuario_id: string; horas: number; capacidad: number }[];
}
export interface Escenario {
  id: IdEscenario;
  titulo: string;
  para_que: string;
  recomendado: boolean;
  tareas: TareaSugerida[];
  impacto: ImpactoEscenario;
}
export interface EscenariosDia {
  escenarios: Escenario[];
  /** Por qué se recomienda ese: la regla en palabras. */
  porque: string;
  /** Atrasadas y quietas: no se sugieren, se le pregunta a su responsable. */
  sigue_viva: { id: string; dias_atraso: number; dias_sin_movimiento: number }[];
}

type R = Pick<
  RequerimientoMetricas,
  | 'id'
  | 'cliente_id'
  | 'owner_agencia'
  | 'fecha_entrega'
  | 'estado_operativo'
  | 'estado_aprobacion'
  | 'dias_atraso'
  | 'dias_sin_movimiento'
  | 'daily_fecha'
  | 'planificacion'
>;

/** Días hacia adelante que se consideran para sugerir; lo que vence después no compite por el día de hoy. */
const DIAS_HORIZONTE = 7;

const r1 = (n: number) => Math.round(n * 10) / 10;
const estaEnCurso = (r: R) => r.estado_operativo === 'en_ejecucion' || r.estado_operativo === 'en_revision';
const esQuieta = (r: R) => r.dias_atraso > 0 && r.dias_sin_movimiento > DIAS_ATRASADA_VIVA;

/** ¿Se puede sugerir? Las ya elegidas hoy se mantienen siempre, sea cual sea su estado. */
function esCandidata(r: R, hoy: string, compromisos: Set<string>): boolean {
  if (!r.owner_agencia.length || r.estado_operativo === 'bloqueado' || r.estado_aprobacion === 'pendiente_cliente') return false;
  // Un compromiso del weekly dice que la tarea sigue viva, aunque lleve días sin moverse.
  if (compromisos.has(r.id)) return true;
  if (esQuieta(r)) return false;
  if (estaEnCurso(r) || r.planificacion === 'urgente' || (r.daily_fecha && r.daily_fecha < hoy)) return true;
  return !!r.fecha_entrega && r.fecha_entrega <= sumarDias(hoy, DIAS_HORIZONTE);
}

/** Cálculo puro de los tres escenarios. */
export function calcularEscenarios(e: {
  activos: R[];
  hoy: string;
  carga: Pick<CargaDia, 'horas' | 'capacidad_dia' | 'otras_mesas'>;
  salud: Map<string, Salud>;
  /** Solo sugerir de estas tareas («mis cuentas»); la carga de las personas sigue siendo la de toda la mesa. */
  soloIds?: Set<string>;
  /** Tareas con un acuerdo abierto del weekly que vence en el horizonte: van primero (docs/05). */
  compromisos?: Set<string>;
}): EscenariosDia {
  const { hoy, carga, salud } = e;
  const compromisos = e.compromisos ?? new Set<string>();
  const manana = sumarDias(hoy, 1);
  const ultimoDia = e.activos.reduce<string | null>(
    (m, r) => (r.daily_fecha && r.daily_fecha < hoy && (!m || r.daily_fecha > m) ? r.daily_fecha : m),
    null,
  );
  const horasDe = (r: R) => r.owner_agencia.reduce((s, o) => s + (carga.horas[r.id]?.[o] ?? 0), 0);

  const razones = (r: R): Razon[] => {
    const x: Razon[] = [];
    if (r.daily_fecha === hoy) x.push('ya_elegida');
    if (r.fecha_entrega === hoy) x.push('vence_hoy');
    if (r.fecha_entrega === manana) x.push('vence_manana');
    if (r.dias_atraso > 0) x.push('atrasada');
    if (compromisos.has(r.id)) x.push('compromiso_weekly');
    if (ultimoDia && r.daily_fecha === ultimoDia) x.push('del_ultimo_daily');
    if (estaEnCurso(r)) x.push('en_curso');
    if (r.planificacion === 'urgente') x.push('urgente');
    if (salud.get(r.cliente_id) === 'rojo') x.push('cliente_rojo');
    if (salud.get(r.cliente_id) === 'amarillo') x.push('cliente_amarillo');
    return x;
  };

  const yaElegidas = e.activos.filter((r) => r.daily_fecha === hoy);
  const candidatas = e.activos.filter(
    (r) => r.daily_fecha !== hoy && (!e.soloIds || e.soloIds.has(r.id)) && esCandidata(r, hoy, compromisos),
  );
  const esCandidataOElegida = (r: R) => r.daily_fecha === hoy || esCandidata(r, hoy, compromisos);
  const vencenHoy = e.activos.filter((r) => r.fecha_entrega === hoy && esCandidataOElegida(r));
  const atrasadasVivas = e.activos.filter((r) => r.dias_atraso > 0 && esCandidataOElegida(r));

  const armar = (id: IdEscenario, titulo: string, para_que: string, orden: R[]): Escenario => {
    const usadas = new Map<string, number>(Object.entries(carga.otras_mesas));
    const elegidas: R[] = [];
    const entra = (r: R) =>
      r.owner_agencia.every((o) => {
        const cap = carga.capacidad_dia[o];
        if (cap === undefined) return false;
        const usada = usadas.get(o) ?? 0;
        // A quien no tiene nada se le deja entrar su primera tarea aunque sola pase del día: si no, nunca saldría.
        return usada === 0 || usada + (carga.horas[r.id]?.[o] ?? 0) <= cap;
      });
    const poner = (r: R) => {
      elegidas.push(r);
      for (const o of r.owner_agencia) usadas.set(o, (usadas.get(o) ?? 0) + (carga.horas[r.id]?.[o] ?? 0));
    };
    for (const r of yaElegidas) poner(r);
    const afuera: R[] = [];
    for (const r of orden) {
      if (entra(r)) poner(r);
      else afuera.push(r);
    }
    const ids = new Set(elegidas.map((r) => r.id));
    const porCliente = new Map<string, number>();
    for (const r of afuera) porCliente.set(r.cliente_id, (porCliente.get(r.cliente_id) ?? 0) + 1);
    const personas = new Set(elegidas.flatMap((r) => r.owner_agencia));
    return {
      id,
      titulo,
      para_que,
      recomendado: false,
      tareas: elegidas.map((r) => ({ id: r.id, razones: razones(r) })),
      impacto: {
        tareas: elegidas.length,
        nuevas: elegidas.length - yaElegidas.length,
        atraso_antes: atrasadasVivas.length,
        atraso_despues: atrasadasVivas.filter((r) => !ids.has(r.id)).length,
        vencen_hoy: vencenHoy.length,
        vencen_hoy_cubiertas: vencenHoy.filter((r) => ids.has(r.id)).length,
        afuera: afuera.length,
        afuera_por_cliente: [...porCliente].map(([cliente_id, n]) => ({ cliente_id, n })).sort((a, b) => b.n - a.n),
        personas: [...personas]
          .map((usuario_id) => ({ usuario_id, horas: r1(usadas.get(usuario_id) ?? 0), capacidad: carga.capacidad_dia[usuario_id] ?? 0 }))
          .sort((a, b) => b.horas - a.horas),
      },
    };
  };

  const porFecha = (a: R, b: R) => (a.fecha_entrega ?? '9999').localeCompare(b.fecha_entrega ?? '9999');
  const compromisoPrimero = (a: R, b: R) => Number(compromisos.has(b.id)) - Number(compromisos.has(a.id));
  // Lo más urgente primero: vence hoy, lo atrasado vivo de lo más viejo a lo más nuevo, y vence mañana.
  const sinVencidos = armar(
    'sin_vencidos',
    'Sin vencidos',
    'Bajar el atraso: lo que vence hoy y lo atrasado que sigue vivo.',
    candidatas
      .filter((r) => r.dias_atraso > 0 || r.fecha_entrega === hoy || r.fecha_entrega === manana || compromisos.has(r.id))
      .sort((a, b) => compromisoPrimero(a, b) || Number(b.fecha_entrega === hoy) - Number(a.fecha_entrega === hoy) || porFecha(a, b)),
  );
  const pesoSalud = (r: R) => (salud.get(r.cliente_id) === 'rojo' ? 0 : salud.get(r.cliente_id) === 'amarillo' ? 1 : 2);
  const cuentasRiesgo = armar(
    'cuentas_riesgo',
    'Cuentas en riesgo',
    'Cuidar las cuentas: primero los clientes en rojo y en amarillo.',
    candidatas.filter((r) => pesoSalud(r) < 2).sort((a, b) => compromisoPrimero(a, b) || pesoSalud(a) - pesoSalud(b) || porFecha(a, b)),
  );
  // Lo que ya está andando o vence pronto, y de eso lo más corto: es lo que más cosas cierra hoy.
  const pronta = (r: R) => estaEnCurso(r) || (!!r.fecha_entrega && r.fecha_entrega <= manana);
  const masEntregas = armar(
    'mas_entregas',
    'Más entregas',
    'Cerrar más cosas hoy: lo más corto que ya está en curso o vence pronto.',
    [...candidatas].sort(
      (a, b) => compromisoPrimero(a, b) || Number(pronta(b)) - Number(pronta(a)) || horasDe(a) - horasDe(b) || porFecha(a, b),
    ),
  );

  const enRojo = new Set(e.activos.filter((r) => salud.get(r.cliente_id) === 'rojo').map((r) => r.cliente_id)).size;
  let recomendado: Escenario, porque: string;
  if (vencenHoy.length || atrasadasVivas.length) {
    recomendado = sinVencidos;
    const partes = [
      vencenHoy.length ? `Hoy ${vencenHoy.length === 1 ? 'vence 1 tarea' : `vencen ${vencenHoy.length} tareas`}` : null,
      atrasadasVivas.length
        ? `hay ${atrasadasVivas.length} ${atrasadasVivas.length === 1 ? 'atrasada que sigue viva' : 'atrasadas que siguen vivas'}`
        : null,
    ].filter(Boolean);
    const frase = partes.join(' y ');
    porque = `${frase.charAt(0).toUpperCase()}${frase.slice(1)}: conviene despejar eso primero.`;
  } else if (enRojo) {
    recomendado = cuentasRiesgo;
    porque = `No hay vencidos, y ${enRojo === 1 ? 'hay 1 cliente' : `hay ${enRojo} clientes`} en rojo: conviene cuidar esas cuentas.`;
  } else {
    recomendado = masEntregas;
    porque = 'No hay vencidos ni cuentas en rojo: es un buen día para cerrar la mayor cantidad de tareas.';
  }
  recomendado.recomendado = true;
  return {
    // Un escenario vacío o con las mismas tareas que otro no es una opción: queda el primero (el recomendado va adelante).
    escenarios: [sinVencidos, cuentasRiesgo, masEntregas]
      .sort((a, b) => Number(b.recomendado) - Number(a.recomendado))
      // El recomendado se queda aunque nada entre, si es por falta de horas: así se ve qué quedó afuera.
      .filter((x) => x.tareas.length > 0 || (x.recomendado && x.impacto.afuera > 0))
      .filter((x, i, xs) => {
        const clave = (y: Escenario) =>
          y.tareas
            .map((t) => t.id)
            .sort()
            .join();
        return xs.findIndex((y) => clave(y) === clave(x)) === i;
      }),
    porque,
    sigue_viva: e.activos
      .filter(
        (r) =>
          esQuieta(r) &&
          !compromisos.has(r.id) &&
          r.estado_aprobacion !== 'pendiente_cliente' &&
          r.estado_operativo !== 'bloqueado' &&
          r.owner_agencia.length > 0,
      )
      .filter((r) => !e.soloIds || e.soloIds.has(r.id))
      .map((r) => ({ id: r.id, dias_atraso: r.dias_atraso, dias_sin_movimiento: r.dias_sin_movimiento }))
      .sort((a, b) => b.dias_atraso - a.dias_atraso),
  };
}

/** Escenarios de hoy para una mesa (o toda la agencia), opcionalmente solo con las cuentas de una ejecutiva. */
export async function escenariosDelDia(ctx: DbCtx, mesaId?: string, ejecutivaId?: string, hoy = hoyLocal()): Promise<EscenariosDia> {
  const alcance = mesaId ? await alcanceMesa(ctx, mesaId, { sinPrueba: true }) : undefined;
  const [activos, prueba, carga, salud, cuentas, acuerdos] = await Promise.all([
    listBacklog(ctx, { solo_activos: true, mesa: alcance }),
    idsClientesDePrueba(ctx),
    cargaDelDia(ctx, alcance, hoy),
    ultimaSaludPorCliente(ctx, sumarDias(hoy, -7), sumarDias(hoy, 1)),
    ejecutivaId ? alcanceEjecutiva(ctx, ejecutivaId).then((a) => listBacklog(ctx, { solo_activos: true, mesa: a })) : Promise.resolve(null),
    listAcuerdosAbiertos(ctx),
  ]);
  const horizonte = sumarDias(hoy, DIAS_HORIZONTE);
  return calcularEscenarios({
    activos: activos.filter((r) => !prueba.has(r.cliente_id)),
    hoy,
    carga,
    salud,
    soloIds: cuentas ? new Set(cuentas.map((r) => r.id)) : undefined,
    compromisos: new Set(acuerdos.filter((a) => a.requerimiento_id && a.fecha_compromiso <= horizonte).map((a) => a.requerimiento_id!)),
  });
}

/**
 * «¿Sigue viva?»: pide a los responsables que confirmen sus tareas atrasadas y quietas. Va a la campana, una por persona, y
 * se responde en Mi día con «¿Ya se entregó?». No cambia ninguna tarea.
 */
export async function preguntarSiSiguenVivas(ctx: DbCtx, ids: string[], quienPide: string): Promise<{ personas: number; tareas: number }> {
  const tareas = await metricasPorIds(ctx, ids);
  const porPersona = new Map<string, string[]>();
  for (const r of tareas as { titulo_interno: string; owner_agencia: string[] }[])
    for (const o of r.owner_agencia) porPersona.set(o, [...(porPersona.get(o) ?? []), r.titulo_interno]);
  for (const [usuarioId, titulos] of porPersona) {
    const n = titulos.length;
    await notificar(
      ctx,
      {
        tipo: 'sigue_viva',
        titulo: `${quienPide} pregunta si ${n === 1 ? 'sigue viva 1 tarea tuya' : `siguen vivas ${n} tareas tuyas`}`,
        cuerpo: `${titulos.slice(0, 5).join('; ')}${n > 5 ? ` y ${n - 5} más` : ''}. Están atrasadas y sin movimiento: respóndelo en un clic en Mi día.`,
        ruta: '/mi-dia',
      },
      { usuarioIds: [usuarioId] },
      { soloCampana: true },
    );
  }
  return { personas: porPersona.size, tareas: tareas.length };
}
