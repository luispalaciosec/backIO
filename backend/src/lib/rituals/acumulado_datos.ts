/** Carga del weekly acumulado: junta lo que `armarAcumulado` necesita para una mesa y una semana. */
import type { Mesa } from '@backio/shared';
import { hoyLocal, sumarDias } from '@backio/shared';
import type { DbCtx } from '../db/client';
import { listClientes } from '../db/clientes';
import { listDailySnapshotsParaRecalcular, listReprocesosAbiertos } from '../db/evolutivo';
import { cargarMesa, diasHabiles, fotoDeDia, inicioDia } from '../evolutivo';
import { armarAcumulado, type AcumuladoSemana } from './acumulado';

export async function acumuladoDeMesa(
  ctx: DbCtx,
  mesa: Mesa,
  semana: { inicio: string; fin: string },
  hoy = hoyLocal(),
): Promise<AcumuladoSemana> {
  const [datos, fotos, abiertos, clientes] = await Promise.all([
    cargarMesa(ctx, mesa, inicioDia(sumarDias(semana.inicio, -7))),
    listDailySnapshotsParaRecalcular(ctx, mesa.id, semana.inicio),
    listReprocesosAbiertos(ctx),
    listClientes(ctx),
  ]);
  // Selección de cada día hábil: la que guardó la foto del evolutivo (la misma que midió el cierre); sin foto, se
  // reconstruye desde la auditoría, y la de hoy se toma en vivo.
  const ultimo = hoy < semana.fin ? hoy : semana.fin;
  const selecciones = new Map<string, Set<string>>();
  for (const dia of diasHabiles(semana.inicio, ultimo)) {
    const foto = fotos.find((f) => f.fecha === dia);
    selecciones.set(dia, foto && dia < hoy ? new Set(foto.seleccion ?? []) : new Set(fotoDeDia(datos, dia, dia < hoy).seleccion));
  }
  const conEquipo = clientes as unknown as { id: string; nombre: string; equipo?: string | null }[];
  return armarAcumulado({
    datos,
    semana,
    selecciones,
    hoy,
    reprocesosAbiertos: abiertos,
    equipoDe: new Map(conEquipo.filter((c) => c.equipo).map((c) => [c.id, c.equipo as string])),
    clientes: new Map(conEquipo.map((c) => [c.id, c.nombre])),
  });
}
