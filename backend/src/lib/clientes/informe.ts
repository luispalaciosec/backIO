/**
 * Informe para el cliente (docs/21): la ejecutiva lo genera desde la ficha, lo edita y lo envía desde su correo.
 *
 * Frontera de visibilidad: la IA recibe el nombre del proyecto (el de la lista, que el cliente ya ve en el portal, D1b),
 * cuántas entregas hubo, cuántas vienen y cuántas esperan al cliente, y el detalle SOLO de lo que devuelve
 * sanitizeForClient (etiquetas para el cliente). El payload pasa por assertClientSafe, igual que el resumen del portal.
 * Nunca recibe títulos internos, responsables, horas ni comentarios. No se publica en el portal.
 *
 * Los números cuentan todas las tareas del proyecto: casi nada es visible (15 de 2.643 al 30/10/2026; lo importado de
 * Basecamp entra oculto y la regla 2 no deja abrirlo). Decisión de Luis: números por proyecto y la ejecutiva completa el
 * detalle a mano antes de enviarlo.
 */
import type { InformeCliente, RequerimientoMetricas } from '@backio/shared';
import { assertClientSafe, diaLocal, entregaReal, hoyLocal, sanitizeForClient, sumarDias } from '@backio/shared';
import type { DbCtx } from '../db/client';
import { getCliente } from '../db/clientes';
import { listProyectos } from '../db/proyectos';
import { listBacklog } from '../db/requerimientos';
import { usuarioDelTenant } from '../db/admin';
import { insertInformeCliente } from '../db/informes_cliente';
import { DbError } from '../db/client';
import { generarJson } from '../ia';

export type PeriodoInforme = 'semanal' | 'mensual';

/** Días hacia adelante que cubre «lo que viene». */
const DIAS_PROXIMOS = 14;

/** Semanal: los últimos 7 días. Mensual: el mes pedido (YYYY-MM), hasta hoy si es el mes en curso. */
export function rangoInforme(periodo: PeriodoInforme, hoy: string, mes?: string): { desde: string; hasta: string } {
  if (periodo === 'semanal') return { desde: sumarDias(hoy, -6), hasta: hoy };
  const m = mes ?? hoy.slice(0, 7);
  const desde = `${m}-01`;
  const [a, mm] = m.split('-').map(Number) as [number, number];
  const fin = new Date(Date.UTC(a, mm, 0)).toISOString().slice(0, 10);
  return { desde, hasta: fin < hoy ? fin : hoy };
}

export interface ProyectoInforme {
  nombre: string;
  /** Avance sobre lo visible para el cliente (0 si no hay nada visible). */
  avance: number;
  fecha_entrega: string;
  /** Cuántas tareas se entregaron en el periodo, cuántas vencen en las 2 semanas siguientes y cuántas esperan al cliente. */
  entregas: number;
  proximas: number;
  esperando: number;
  /** Días que lleva la que más espera al cliente (desde su último movimiento, como el portal). */
  espera_max_dias: number | null;
  /** Detalle con etiqueta para el cliente (solo lo visible). */
  entregado: { titulo: string; fecha: string }[];
  proximo: { titulo: string; fecha: string | null }[];
  esperando_cliente: { titulo: string; dias: number }[];
}

export interface DatosInforme {
  cliente: string;
  periodo: PeriodoInforme;
  desde: string;
  hasta: string;
  firma: string | null;
  proyectos: ProyectoInforme[];
}

type Req = Pick<
  RequerimientoMetricas,
  | 'id'
  | 'proyecto_id'
  | 'etiqueta_cliente'
  | 'visible_cliente'
  | 'peso'
  | 'estado_operativo'
  | 'estado_aprobacion'
  | 'fecha_entrega'
  | 'ultima_actualizacion'
  | 'completado_at'
  | 'entregado_el'
>;

/**
 * Arma los datos del informe por proyecto, siempre a través de sanitizeForClient: lo entregado en el periodo, lo que
 * vence en las 2 semanas siguientes y lo que espera al cliente. Los proyectos sin nada que contar no van. Pura.
 */
export function datosInforme(
  e: { cliente: string; periodo: PeriodoInforme; desde: string; hasta: string; firma: string | null },
  proyectos: { id: string; nombre: string; fecha_entrega: string; estado: string }[],
  reqs: Req[],
): DatosInforme {
  const limite = sumarDias(e.hasta, DIAS_PROXIMOS);
  const out: ProyectoInforme[] = [];
  for (const p of proyectos) {
    if (p.estado === 'cancelado') continue;
    const suyos = reqs.filter((r) => r.proyecto_id === p.id);
    const entregaDe = new Map(suyos.map((r) => [r.id, diaLocal(entregaReal(r))]));
    const entregados = suyos.filter((r) => {
      const d = r.estado_operativo === 'completado' ? entregaDe.get(r.id) : null;
      return !!d && d >= e.desde && d <= e.hasta;
    });
    const proximos = suyos.filter(
      (r) =>
        !['completado', 'cancelado'].includes(r.estado_operativo) &&
        r.estado_aprobacion !== 'pendiente_cliente' &&
        !!r.fecha_entrega &&
        r.fecha_entrega > e.hasta &&
        r.fecha_entrega <= limite,
    );
    const esperan = suyos.filter(
      (r) => r.estado_aprobacion === 'pendiente_cliente' && !['completado', 'cancelado'].includes(r.estado_operativo),
    );
    const todo = sanitizeForClient(p, suyos);
    const entregado = sanitizeForClient(p, entregados)
      .hitos.map((h) => ({ titulo: h.titulo, fecha: entregaDe.get(h.id)! }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
    const proximo = sanitizeForClient(p, proximos)
      .hitos.map((h) => ({ titulo: h.titulo, fecha: h.fecha_estimada }))
      .sort((a, b) => (a.fecha ?? '').localeCompare(b.fecha ?? ''));
    if (!entregados.length && !proximos.length && !esperan.length) continue;
    out.push({
      nombre: todo.nombre,
      avance: todo.avance,
      fecha_entrega: todo.fecha_entrega,
      entregas: entregados.length,
      proximas: proximos.length,
      esperando: esperan.length,
      espera_max_dias: esperan.length
        ? Math.max(
            ...esperan.map((r) => Math.floor((Date.parse(`${e.hasta}T23:59:59Z`) - Date.parse(r.ultima_actualizacion)) / 86_400_000)),
          )
        : null,
      entregado,
      proximo,
      esperando_cliente: todo.bloqueado_por_cliente,
    });
  }
  return { ...e, proyectos: out };
}

const SYSTEM_INFORME = `Redactas, en nombre de la ejecutiva de cuenta de Geeks Ecuador, un borrador de correo para el cliente con el informe de un periodo.
Recibes por proyecto: cuántas entregas hubo en el periodo ("entregas"), cuántas vienen en las próximas dos semanas ("proximas"), cuántas esperan respuesta del cliente ("esperando", y "espera_max_dias") y, a veces, el detalle con nombre de algunas ("entregado", "proximo", "esperando_cliente").
Estructura del cuerpo:
1. Saludo breve («Hola, equipo de <cliente>:») y una frase con el periodo.
2. Lo entregado: una viñeta «- » por proyecto con su número de entregas y, si hay detalle, los nombres con su fecha.
3. Lo que viene, igual, con las próximas.
4. Si algo espera al cliente, qué necesitamos de su lado (cuántas, desde hace cuántos días la más antigua, y los nombres si están), con amabilidad y sin reclamo. Si nada espera, omítelo.
5. Cierre corto y la firma (el campo "firma"; si no hay, «Equipo Geeks»).
Cuando un proyecto tiene entregas o próximas sin detalle con nombre, agrega en la misma viñeta «[completa: qué se entregó]» o «[completa: qué viene]», para que la ejecutiva lo escriba antes de enviar. Nunca inventes qué fue.
Reglas: fechas como «martes 4 de noviembre». Texto plano con viñetas «- », sin negritas ni otro formato. No menciones porcentajes de avance de 0 %. No prometas fechas que no estén en los datos.
Formato: {"asunto":"…","cuerpo":"…"}. El asunto: «Informe <semanal|mensual> · <cliente> · <periodo legible>».`;

/** Genera el informe con la IA, lo guarda en el historial y lo devuelve. 404 si el cliente no existe. */
export async function generarInformeCliente(
  ctx: DbCtx,
  clienteId: string,
  periodo: PeriodoInforme,
  opts: { mes?: string; hoy?: string } = {},
): Promise<InformeCliente> {
  const cliente = await getCliente(ctx, clienteId);
  if (!cliente) throw new DbError('Cliente no encontrado', 404);
  const { desde, hasta } = rangoInforme(periodo, opts.hoy ?? hoyLocal(), opts.mes);
  const [proyectos, reqs, yo] = await Promise.all([
    listProyectos(ctx, { cliente_id: clienteId }),
    listBacklog(ctx, { cliente_id: clienteId }),
    ctx.usuarioId ? usuarioDelTenant(ctx, ctx.usuarioId) : Promise.resolve(null),
  ]);
  const datos = datosInforme({ cliente: cliente.nombre, periodo, desde, hasta, firma: yo?.nombre ?? null }, proyectos, reqs);
  // La frontera: nada con nombre de campo interno sale hacia la IA ni se guarda como «datos del cliente».
  assertClientSafe(datos);
  if (!datos.proyectos.length) throw new DbError('No hay entregas, próximas entregas ni pendientes del cliente en ese periodo', 422);
  const r = await generarJson<{ asunto?: unknown; cuerpo?: unknown }>(ctx, {
    tipo: 'informe_cliente',
    entidad: { tipo: 'cliente', id: clienteId },
    payload: datos,
    system: SYSTEM_INFORME,
    maxTokens: 1800,
    cacheMs: 0,
  });
  if (typeof r.asunto !== 'string' || typeof r.cuerpo !== 'string' || !r.cuerpo.trim())
    throw new DbError('La IA devolvió un informe incompleto. Vuelve a intentar.', 502);
  return insertInformeCliente(ctx, {
    cliente_id: clienteId,
    periodo,
    desde,
    hasta,
    asunto: r.asunto.trim(),
    cuerpo: r.cuerpo.trim(),
    datos,
  });
}
