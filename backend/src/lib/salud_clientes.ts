/**
 * Salud de los clientes en el tiempo (docs/22): una foto diaria del color de cada cliente (cliente_salud, migración 38)
 * y un aviso a la ejecutiva de la cuenta y al líder de su mesa cuando el color cambia, para bien o para mal.
 * El color sale del dashboard (saludCliente), así es el mismo que ven la ficha y la lista de clientes.
 */
import type { Salud } from '@backio/shared';
import { hoyLocal, sumarDias } from '@backio/shared';
import { serviceClient, type DbCtx } from './db/client';
import { guardarSaludDelDia, listSaludCliente, ultimaSaludPorCliente } from './db/cliente_salud';
import { buildDashboard } from './dashboard';
import { listClientes } from './db/clientes';
import { listMesas } from './db/mesas';
import { notificar } from './notificaciones';

export interface FotoSalud {
  cliente_id: string;
  cliente: string;
  salud: Salud;
  motivos: string[];
}
export interface CambioSalud extends FotoSalud {
  antes: Salud;
}

const NOMBRE: Record<Salud, string> = { verde: 'verde', amarillo: 'amarillo', rojo: 'rojo' };
const ORDEN: Record<Salud, number> = { verde: 0, amarillo: 1, rojo: 2 };

/** Clientes cuyo color de hoy es distinto del último registrado antes de hoy. Sin registro previo no hay cambio. */
export function cambiosDeSalud(hoy: FotoSalud[], previo: Map<string, Salud>): CambioSalud[] {
  return hoy.flatMap((f) => {
    const antes = previo.get(f.cliente_id);
    return antes && antes !== f.salud ? [{ ...f, antes }] : [];
  });
}

export function textoCambio(c: CambioSalud): { titulo: string; cuerpo: string } {
  const mejora = ORDEN[c.salud] < ORDEN[c.antes];
  return {
    titulo: `${c.cliente} pasó de ${NOMBRE[c.antes]} a ${NOMBRE[c.salud]}`,
    cuerpo: mejora
      ? c.motivos.length
        ? `Mejoró. Todavía: ${c.motivos.join(' · ')}.`
        : 'Mejoró: ya no tiene motivos de alerta.'
      : `Por qué: ${c.motivos.join(' · ')}.`,
  };
}

/** Toma la foto del día (idempotente por cliente y día) y avisa los cambios. La corre la tarea programada. */
export async function fotoSaludClientes(ctx: DbCtx, hoy = hoyLocal()): Promise<{ clientes: number; cambios: number }> {
  const db = serviceClient();
  const d = await buildDashboard({ ...ctx, db });
  const fotos: FotoSalud[] = d.por_cliente.map((c) => ({
    cliente_id: c.cliente_id,
    cliente: c.cliente,
    salud: c.salud,
    motivos: c.salud_motivos,
  }));
  const previo = await ultimaSaludPorCliente(ctx, sumarDias(hoy, -30), hoy);
  await guardarSaludDelDia(ctx, hoy, fotos);

  const cambios = cambiosDeSalud(fotos, previo);
  if (cambios.length) {
    const [clientes, mesas] = await Promise.all([listClientes({ ...ctx, db }), listMesas({ ...ctx, db })]);
    for (const c of cambios) {
      const cl = clientes.find((x) => x.id === c.cliente_id);
      const lider = mesas.find((m) => m.id === cl?.mesa_id)?.lider_id;
      const destino = [cl?.ejecutiva_id, lider].filter((x): x is string => !!x);
      await notificar(
        ctx,
        { tipo: 'salud_cliente', ...textoCambio(c), ruta: `/clientes/${c.cliente_id}`, entidad_tipo: 'cliente', entidad_id: c.cliente_id },
        destino.length ? { usuarioIds: [...new Set(destino)] } : { roles: ['operaciones'] },
      );
    }
  }
  return { clientes: fotos.length, cambios: cambios.length };
}

/** Evolución del color de un cliente (para la ficha), del más antiguo al más reciente. */
export async function historialSalud(ctx: DbCtx, clienteId: string, dias = 30): Promise<{ fecha: string; salud: Salud }[]> {
  return listSaludCliente(ctx, clienteId, sumarDias(hoyLocal(), -dias));
}
