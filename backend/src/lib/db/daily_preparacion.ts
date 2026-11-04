/** Lo que cada ejecutiva prepara para el daily de su mesa (migración 42, docs/05). Cada persona escribe solo su fila. */
import type { DbCtx } from './client';
import { throwIf } from './client';

export type TipoDaily = 'apertura' | 'cierre';

export interface FilaPreparacion {
  usuario_id: string;
  notas: string[];
  listo_at: string | null;
  updated_at: string;
}

export async function listPreparacion(ctx: DbCtx, mesaId: string, fecha: string, tipo: TipoDaily): Promise<FilaPreparacion[]> {
  const { data, error } = await ctx.db
    .from('daily_preparacion')
    .select('usuario_id, notas, listo_at, updated_at')
    .eq('tenant_id', ctx.tenantId)
    .eq('mesa_id', mesaId)
    .eq('fecha', fecha)
    .eq('tipo', tipo)
    .order('created_at');
  throwIf(error);
  return (data ?? []).map((f) => ({ ...f, notas: Array.isArray(f.notas) ? (f.notas as string[]) : [] }));
}

export async function guardarPreparacion(
  ctx: DbCtx,
  usuarioId: string,
  mesaId: string,
  fecha: string,
  tipo: TipoDaily,
  cambios: { notas: string[]; listo_at: string | null },
): Promise<void> {
  const { error } = await ctx.db
    .from('daily_preparacion')
    .upsert(
      { tenant_id: ctx.tenantId, mesa_id: mesaId, fecha, tipo, usuario_id: usuarioId, ...cambios },
      { onConflict: 'tenant_id,mesa_id,fecha,tipo,usuario_id' },
    );
  throwIf(error);
}
