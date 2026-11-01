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

/** Texto del correo: una línea por bloque con hasta 3 tareas. null si no hay nada que contar (no se envía). */
export function resumenMiDia(m: MiDia, cliente: (id: string) => string): { titulo: string; cuerpo: string } | null {
  if (vacio(m)) return null;
  const tareas = (xs: RequerimientoMetricas[]) =>
    xs
      .slice(0, 3)
      .map((r) => `${r.titulo_interno}${cliente(r.cliente_id) ? ` (${cliente(r.cliente_id)})` : ''}`)
      .join('; ') + (xs.length > 3 ? ` y ${xs.length - 3} más` : '');
  const lineas = [
    m.hoy.length ? `Hoy trabajas en ${m.hoy.length}: ${tareas(m.hoy)}.` : null,
    m.vencen.length ? `Vencen hoy o mañana ${m.vencen.length}: ${tareas(m.vencen)}.` : null,
    m.atrasadas.length ? `Atrasadas ${m.atrasadas.length}: ${tareas(m.atrasadas)}.` : null,
    m.preguntar.length
      ? `¿Ya se entregaron? ${m.preguntar.length} ${m.preguntar.length === 1 ? 'tarea pasó su fecha' : 'tareas pasaron su fecha'} sin moverse: respóndelo en un clic en Mi día.`
      : null,
    m.bloqueadas.length ? `Bloqueadas ${m.bloqueadas.length}: ${tareas(m.bloqueadas)}.` : null,
    m.esperando_cliente.length ? `Esperando al cliente ${m.esperando_cliente.length}.` : null,
    m.cuentas && (m.cuentas.atrasadas.length || m.cuentas.esperando_cliente.length)
      ? `Tus cuentas: ${m.cuentas.atrasadas.length} ${m.cuentas.atrasadas.length === 1 ? 'tarea atrasada' : 'tareas atrasadas'}${
          m.cuentas.esperando_cliente.length
            ? `; ${m.cuentas.esperando_cliente.length} esperan al cliente (la más antigua hace ${m.cuentas.esperando_cliente[0]!.dias_esperando} d): pide el feedback`
            : ''
        }.`
      : null,
  ].filter((x): x is string => !!x);
  const partes = [
    m.hoy.length ? `${m.hoy.length} para hoy` : null,
    m.vencen.length ? `${m.vencen.length} vencen` : null,
    m.preguntar.length ? `${m.preguntar.length} por confirmar` : null,
    m.cuentas?.esperando_cliente.length ? `${m.cuentas.esperando_cliente.length} esperan al cliente` : null,
  ].filter(Boolean);
  return { titulo: `Tu día${partes.length ? `: ${partes.join(', ')}` : ''}`, cuerpo: lineas.join('\n') };
}
