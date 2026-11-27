/** Reuniones y visitas (`reuniones`, docs/23): solo horario, persona, cliente y dominios. Nunca títulos ni correos. */
import { type DbCtx, type FilaInsert, serviceClient, throwIf } from './client';
import { paginar } from './paginar';

export interface FilaReunion {
  id: string;
  usuario_id: string;
  origen: string;
  externo_id: string;
  inicio: string;
  fin: string;
  fecha: string;
  horas: number;
  cliente_id: string | null;
  asignacion: string | null;
}

const CAMPOS = 'id, usuario_id, origen, externo_id, inicio, fin, fecha, horas, cliente_id, asignacion';

/** Reuniones vigentes entre dos días (YYYY-MM-DD, inclusive). Con service role: la usan cálculos del servidor. */
export async function listReunionesEntre(ctx: DbCtx, desde: string, hasta: string): Promise<FilaReunion[]> {
  const db = serviceClient();
  return paginar<FilaReunion>((a, b) =>
    db
      .from('reuniones')
      .select(CAMPOS)
      .eq('tenant_id', ctx.tenantId)
      .eq('cancelada', false)
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('id')
      .range(a, b),
  );
}

/** Las de un origen en la ventana, también las canceladas: para saber qué desapareció y qué se asignó a mano. */
export async function listReunionesDeOrigen(
  tenantId: string,
  origen: 'basecamp' | 'google',
  desde: string,
  hasta: string,
  usuarioId?: string,
): Promise<
  { id: string; usuario_id: string; externo_id: string; cliente_id: string | null; asignacion: string | null; cancelada: boolean }[]
> {
  const db = serviceClient();
  return paginar((a, b) => {
    let q = db
      .from('reuniones')
      .select('id, usuario_id, externo_id, cliente_id, asignacion, cancelada')
      .eq('tenant_id', tenantId)
      .eq('origen', origen)
      .gte('fecha', desde)
      .lte('fecha', hasta);
    if (usuarioId) q = q.eq('usuario_id', usuarioId);
    return q.order('id').range(a, b);
  });
}

/** Upsert por (tenant, persona, origen, evento), de a 500. Devuelve cuántas quedaron guardadas. */
export async function upsertReuniones(filas: FilaInsert<'reuniones'>[]): Promise<number> {
  const db = serviceClient();
  let n = 0;
  for (let i = 0; i < filas.length; i += 500) {
    const { data, error } = await db
      .from('reuniones')
      .upsert(filas.slice(i, i + 500), { onConflict: 'tenant_id,usuario_id,origen,externo_id' })
      .select('id');
    throwIf(error);
    n += (data ?? []).length;
  }
  return n;
}

/** Marca canceladas las que ya no están en la fuente (se conservan: no se borra historia). */
export async function cancelarReuniones(ids: string[]): Promise<void> {
  const db = serviceClient();
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await db
      .from('reuniones')
      .update({ cancelada: true })
      .in('id', ids.slice(i, i + 200));
    throwIf(error);
  }
}
