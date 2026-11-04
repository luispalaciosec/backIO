/**
 * «Mi día» (docs/22): lo de cada persona para hoy, en la página /mi-dia y en un correo de lunes a viernes a las 07:45.
 * El correo es un resumen con enlace a la página: los botones que escriben están en BackIO, no en el correo.
 */
import type { RequerimientoMetricas } from '@backio/shared';
import { hoyLocal, sumarDias } from '@backio/shared';
import type { DbCtx } from './db/client';
import { listBacklog } from './db/requerimientos';
import { idsClientesDePrueba } from './db/clientes';
import { alcanceEjecutiva } from './db/mesas';
import { debePreguntarse } from './entregas';
import { diasEsperandoCliente } from './rituals/service';
import type { CorreoRico, CorreoSeccion } from './notificaciones/email';

export interface MiDia {
  hoy: RequerimientoMetricas[];
  vencen: RequerimientoMetricas[];
  atrasadas: RequerimientoMetricas[];
  bloqueadas: RequerimientoMetricas[];
  esperando_cliente: RequerimientoMetricas[];
  /** «¿Ya se entregó?» (subconjunto de las atrasadas). */
  preguntar: RequerimientoMetricas[];
  /**
   * Solo para quien es ejecutiva de alguna cuenta: lo atrasado de sus clientes y lo que espera al cliente, sea de quien
   * sea la tarea. Antes Mi día de una ejecutiva mostraba solo las tareas donde era responsable (revisión del 31/10/2026).
   */
  cuentas?: CuentasMiDia;
}

export interface CuentasMiDia {
  atrasadas: RequerimientoMetricas[];
  esperando_cliente: (RequerimientoMetricas & { dias_esperando: number })[];
}

/** Lo de las cuentas de una ejecutiva: atrasado (nuestro) y esperando al cliente, lo más antiguo primero. Pura. */
export function armarCuentas(activas: RequerimientoMetricas[], espera: Map<string, number>): CuentasMiDia {
  return {
    atrasadas: activas
      .filter((r) => r.dias_atraso > 0 && r.estado_aprobacion !== 'pendiente_cliente')
      .sort((a, b) => b.dias_atraso - a.dias_atraso),
    esperando_cliente: activas
      .filter((r) => r.estado_aprobacion === 'pendiente_cliente')
      .map((r) => ({ ...r, dias_esperando: espera.get(r.id) ?? r.dias_sin_movimiento }))
      .sort((a, b) => b.dias_esperando - a.dias_esperando),
  };
}

/** Arma «Mi día» a partir de las tareas abiertas de la persona (sin clientes de prueba). Puro: se prueba sin base. */
export function armarMiDia(activas: RequerimientoMetricas[], hoy: string): MiDia {
  const manana = sumarDias(hoy, 1);
  return {
    hoy: activas.filter((r) => r.daily_fecha === hoy),
    vencen: activas.filter((r) => r.fecha_entrega && r.fecha_entrega >= hoy && r.fecha_entrega <= manana),
    atrasadas: activas.filter((r) => r.dias_atraso > 0).sort((a, b) => b.dias_atraso - a.dias_atraso),
    bloqueadas: activas.filter((r) => r.estado_operativo === 'bloqueado'),
    esperando_cliente: activas.filter((r) => r.estado_aprobacion === 'pendiente_cliente'),
    preguntar: activas.filter(debePreguntarse).sort((a, b) => b.dias_atraso - a.dias_atraso),
  };
}

export async function miDia(ctx: DbCtx, usuarioId: string, hoy = hoyLocal()): Promise<MiDia> {
  const [activas, prueba, alcance] = await Promise.all([
    listBacklog(ctx, { owner: usuarioId, solo_activos: true }),
    idsClientesDePrueba(ctx),
    alcanceEjecutiva(ctx, usuarioId),
  ]);
  const m = armarMiDia(
    activas.filter((r) => !prueba.has(r.cliente_id)),
    hoy,
  );
  if (!alcance.clienteIds.length && !alcance.proyectoIds.length) return m;
  const deSusCuentas = await listBacklog(ctx, { solo_activos: true, mesa: alcance });
  return { ...m, cuentas: armarCuentas(deSusCuentas, await diasEsperandoCliente(ctx, deSusCuentas)) };
}

const vacio = (m: MiDia) =>
  !m.hoy.length &&
  !m.vencen.length &&
  !m.atrasadas.length &&
  !m.bloqueadas.length &&
  !m.cuentas?.atrasadas.length &&
  !m.cuentas?.esperando_cliente.length;

const FILAS_POR_BLOQUE = 5;
const dias = (n: number) => `${n} ${n === 1 ? 'día' : 'días'}`;
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/**
 * El aviso de cada mañana. Cada tarea sale una sola vez, en el bloque que más pide de la persona: antes las 5 atrasadas
 * salían también como «¿Ya se entregaron?» y el correo repetía lo mismo dos veces. `cuerpo` es para la campana; el correo
 * usa `correo`. null si no hay nada que contar (no se envía).
 */
export function resumenMiDia(
  m: MiDia,
  cliente: (id: string) => string,
  opts: { nombre?: string; hoy?: string } = {},
): { titulo: string; cuerpo: string; correo: CorreoRico } | null {
  if (vacio(m)) return null;
  const hoyStr = opts.hoy ?? hoyLocal();
  const vistas = new Set<string>();
  const unicas = <T extends RequerimientoMetricas>(xs: T[]): T[] =>
    xs.filter((r) => {
      if (vistas.has(r.id)) return false;
      vistas.add(r.id);
      return true;
    });
  const hoy = unicas(m.hoy);
  const vencen = unicas(m.vencen);
  const bloqueadas = unicas(m.bloqueadas);
  const esperando = unicas(m.esperando_cliente);
  const preguntar = unicas(m.preguntar);
  const atrasadas = unicas(m.atrasadas);
  const cuentasEsperan = unicas(m.cuentas?.esperando_cliente ?? []);
  const cuentasAtrasadas = unicas(m.cuentas?.atrasadas ?? []);

  const tareas = (xs: RequerimientoMetricas[]) =>
    xs
      .slice(0, 3)
      .map((r) => `${r.titulo_interno}${cliente(r.cliente_id) ? ` (${cliente(r.cliente_id)})` : ''}`)
      .join('; ') + (xs.length > 3 ? ` y ${xs.length - 3} más` : '');
  const lineas = [
    hoy.length ? `Hoy trabajas en ${hoy.length}: ${tareas(hoy)}.` : null,
    vencen.length ? `Vencen hoy o mañana ${vencen.length}: ${tareas(vencen)}.` : null,
    preguntar.length
      ? `¿Ya se entregaron? ${preguntar.length} ${preguntar.length === 1 ? 'tarea pasó su fecha' : 'tareas pasaron su fecha'} sin moverse: respóndelo en un clic en Mi día.`
      : null,
    atrasadas.length ? `Atrasadas ${atrasadas.length}: ${tareas(atrasadas)}.` : null,
    bloqueadas.length ? `Bloqueadas ${bloqueadas.length}: ${tareas(bloqueadas)}.` : null,
    esperando.length ? `Esperando al cliente ${esperando.length}.` : null,
    m.cuentas && (m.cuentas.atrasadas.length || m.cuentas.esperando_cliente.length)
      ? `Tus cuentas: ${m.cuentas.atrasadas.length} ${m.cuentas.atrasadas.length === 1 ? 'tarea atrasada' : 'tareas atrasadas'}${
          m.cuentas.esperando_cliente.length
            ? `; ${m.cuentas.esperando_cliente.length} esperan al cliente (la más antigua hace ${m.cuentas.esperando_cliente[0]!.dias_esperando} d): pide el feedback`
            : ''
        }.`
      : null,
  ].filter((x): x is string => !!x);

  const nAtrasadas = preguntar.length + atrasadas.length;
  const partes = [
    hoy.length ? `${hoy.length} para hoy` : null,
    vencen.length ? plural(vencen.length, 'vence', 'vencen') : null,
    nAtrasadas ? plural(nAtrasadas, 'atrasada', 'atrasadas') : null,
    m.cuentas?.esperando_cliente.length ? plural(m.cuentas.esperando_cliente.length, 'espera al cliente', 'esperan al cliente') : null,
  ].filter(Boolean);

  const conCliente = (r: RequerimientoMetricas, detalle: string) => [cliente(r.cliente_id), detalle].filter(Boolean).join(' · ');
  const bloque = <T extends RequerimientoMetricas>(
    titulo: string,
    tono: CorreoSeccion['tono'],
    xs: T[],
    detalle: (r: T) => string,
    nota?: string,
  ): CorreoSeccion | null =>
    xs.length
      ? {
          titulo,
          tono,
          total: xs.length,
          ...(nota ? { nota } : {}),
          filas: xs.slice(0, FILAS_POR_BLOQUE).map((r) => ({ texto: r.titulo_interno, detalle: conCliente(r, detalle(r)) })),
        }
      : null;
  const atraso = (r: RequerimientoMetricas) => (r.dias_atraso > 0 ? `${dias(r.dias_atraso)} de atraso` : '');
  const secciones = [
    bloque('Hoy trabajas en', 'azul', hoy, (r) => (r.fecha_entrega === hoyStr ? 'vence hoy' : atraso(r))),
    bloque('Vencen hoy o mañana', 'ambar', vencen, (r) => (r.fecha_entrega === hoyStr ? 'vence hoy' : 'vence mañana')),
    bloque('¿Ya se entregaron?', 'ambar', preguntar, atraso, 'Pasaron su fecha sin moverse. Respóndelo en un clic en Mi día.'),
    bloque('Atrasadas', 'rojo', atrasadas, atraso),
    bloque('Bloqueadas', 'rojo', bloqueadas, atraso),
    bloque('Esperando al cliente', 'gris', esperando, () => ''),
    bloque('Tus cuentas: esperan al cliente', 'gris', cuentasEsperan, (r) => `hace ${dias(r.dias_esperando)}`, 'Pide el feedback.'),
    bloque('Tus cuentas: atrasadas', 'rojo', cuentasAtrasadas, atraso),
  ].filter((x): x is CorreoSeccion => !!x);

  const intro = vencen.length
    ? `Lo primero: ${vencen.length === 1 ? 'una tarea vence' : `${vencen.length} tareas vencen`} hoy o mañana.`
    : preguntar.length
      ? `Lo primero: confirma si ya ${preguntar.length === 1 ? 'se entregó la tarea que pasó su fecha' : `se entregaron las ${preguntar.length} tareas que pasaron su fecha`}.`
      : hoy.length
        ? `Hoy tienes ${plural(hoy.length, 'tarea elegida', 'tareas elegidas')} en el daily.`
        : bloqueadas.length
          ? `Lo primero: ${plural(bloqueadas.length, 'tarea bloqueada necesita', 'tareas bloqueadas necesitan')} que alguien la destrabe.`
          : 'Esto es lo que tienes pendiente hoy.';
  return {
    titulo: `Tu día${partes.length ? `: ${partes.join(', ')}` : ''}`,
    cuerpo: lineas.join('\n'),
    correo: {
      ...(opts.nombre ? { saludo: `Buenos días, ${opts.nombre.split(' ')[0]}` } : {}),
      intro,
      secciones,
      accion: preguntar.length ? 'Responder en Mi día' : 'Abrir Mi día',
      pie: 'Te llega de lunes a viernes a las 07:45. Puedes apagarlo en Mi día. No respondas a este correo.',
    },
  };
}
