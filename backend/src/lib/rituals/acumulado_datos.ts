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
  // Equipo de cada cliente: el configurado en Admin → Clientes; si no tiene, el de su ejecutiva de cuenta («Cuentas de …»,
  // decisión del 28/11 para las mesas sin equipos propios). Sin ninguno de los dos, «Sin equipo».
  const primerNombre = (id: string) => (datos.nombres.get(id) ?? '').split(' ')[0] ?? '';
  const equipoDe = new Map<string, string>();
  for (const c of clientes) {
    if (c.equipo?.trim()) equipoDe.set(c.id, c.equipo.trim());
    else if (c.ejecutiva_id && primerNombre(c.ejecutiva_id)) equipoDe.set(c.id, `Cuentas de ${primerNombre(c.ejecutiva_id)}`);
  }
  return armarAcumulado({
    datos,
    semana,
    selecciones,
    hoy,
    reprocesosAbiertos: abiertos,
    equipoDe,
    clientes: new Map(clientes.map((c) => [c.id, c.nombre])),
  });
}
