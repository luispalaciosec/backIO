/** Reprogramaciones y reprocesos por requerimiento + agregados de cumplimiento. */
import type { Reprogramacion, Reproceso, MotivoReprogramacion, MotivoReproceso, OrigenReproceso } from '@backio/shared';
import { type DbCtx, throwIf } from './client';

export async function listReprogramaciones(ctx: DbCtx, requerimientoId: string): Promise<Reprogramacion[]> {
  const { data, error } = await ctx.db.from('reprogramaciones').select('*').eq('tenant_id', ctx.tenantId).eq('requerimiento_id', requerimientoId).order('created_at', { ascending: false });
  throwIf(error); return (data ?? []) as Reprogramacion[];
}
export async function listReprocesos(ctx: DbCtx, requerimientoId: string): Promise<Reproceso[]> {
  const { data, error } = await ctx.db.from('reprocesos').select('*').eq('tenant_id', ctx.tenantId).eq('requerimiento_id', requerimientoId).order('abierto_at', { ascending: false });
  throwIf(error); return ((data ?? []) as Reproceso[]).map((r) => ({ ...r, horas_reproceso: r.horas_reproceso === null ? null : Number(r.horas_reproceso) }));
}

/** El trigger deja la fila con motivo null y origen 'desconocido'; el backend la completa justo después del update. */
/** Reintenta sin `observacion` si la columna aún no existe (migración 17 pendiente). */
async function conObservacionOpcional<T>(fn: (incluir: boolean) => Promise<{ error: { message?: string } | null; data?: T }>): Promise<{ error: { message?: string } | null; data?: T }> {
  const r = await fn(true);
  if (r.error && /observacion/i.test(r.error.message ?? '')) return fn(false);
  return r;
}

export async function completarUltimaReprogramacion(ctx: DbCtx, requerimientoId: string, datos: { motivo: MotivoReprogramacion | null; origen: string; observacion?: string | null }): Promise<void> {
  const { data } = await ctx.db.from('reprogramaciones').select('id').eq('tenant_id', ctx.tenantId).eq('requerimiento_id', requerimientoId).eq('origen', 'desconocido').order('created_at', { ascending: false }).limit(1).maybeSingle();
  const row = data as { id: string } | null;
  if (!row) return;
  const { error } = await conObservacionOpcional((inc) => ctx.db.from('reprogramaciones').update({ motivo: datos.motivo, origen: datos.origen, usuario_id: ctx.usuarioId, ...(inc && datos.observacion ? { observacion: datos.observacion } : {}) }).eq('id', row.id));
  throwIf(error as never);
}
export async function setMotivoReprogramacion(ctx: DbCtx, id: string, motivo: MotivoReprogramacion, observacion?: string | null): Promise<void> {
  const { error } = await conObservacionOpcional((inc) => ctx.db.from('reprogramaciones').update({ motivo, ...(inc && observacion ? { observacion } : {}) }).eq('tenant_id', ctx.tenantId).eq('id', id));
  throwIf(error as never);
}
export async function insertReproceso(ctx: DbCtx, r: { requerimiento_id: string; origen: OrigenReproceso; motivo: MotivoReproceso | null; paso_retorno: string | null; fecha_entrega_antes: string | null; observacion?: string | null }): Promise<Reproceso> {
  const { observacion, ...resto } = r;
  const { data, error } = await conObservacionOpcional<Reproceso>((inc) => ctx.db.from('reprocesos').insert({ ...resto, tenant_id: ctx.tenantId, usuario_id: ctx.usuarioId, ...(inc && observacion ? { observacion } : {}) }).select().single());
  throwIf(error as never); return data as Reproceso;
}
export async function updateReproceso(ctx: DbCtx, id: string, patch: Partial<Pick<Reproceso, 'motivo' | 'paso_retorno' | 'cerrado_at' | 'horas_reproceso' | 'observacion'>>): Promise<void> {
  const { observacion, ...resto } = patch;
  const { error } = await conObservacionOpcional((inc) => ctx.db.from('reprocesos').update({ ...resto, ...(inc && observacion !== undefined ? { observacion } : {}) }).eq('tenant_id', ctx.tenantId).eq('id', id));
  throwIf(error as never);
}
export async function reprocesoAbierto(ctx: DbCtx, requerimientoId: string): Promise<Reproceso | null> {
  const { data } = await ctx.db.from('reprocesos').select('*').eq('tenant_id', ctx.tenantId).eq('requerimiento_id', requerimientoId).is('cerrado_at', null).order('abierto_at', { ascending: false }).limit(1).maybeSingle();
  return (data as Reproceso) ?? null;
}

/** Pendientes de causa: reprogramaciones y reprocesos sin motivo (para el Weekly y las señales). */
export async function listSinMotivo(ctx: DbCtx, dias = 30): Promise<{ reprogramaciones: Reprogramacion[]; reprocesos: Reproceso[] }> {
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
  const [a, b] = await Promise.all([
    ctx.db.from('reprogramaciones').select('*').eq('tenant_id', ctx.tenantId).is('motivo', null).gte('created_at', desde).order('created_at', { ascending: false }),
    ctx.db.from('reprocesos').select('*').eq('tenant_id', ctx.tenantId).is('motivo', null).gte('abierto_at', desde).order('abierto_at', { ascending: false }),
  ]);
  throwIf(a.error); throwIf(b.error);
  return { reprogramaciones: (a.data ?? []) as Reprogramacion[], reprocesos: (b.data ?? []) as Reproceso[] };
}

/** Todas las reprogramaciones y reprocesos desde una fecha (para dashboard e informe). */
export async function listCumplimientoDesde(ctx: DbCtx, desdeIso: string): Promise<{ reprogramaciones: Reprogramacion[]; reprocesos: Reproceso[] }> {
  const [a, b] = await Promise.all([
    ctx.db.from('reprogramaciones').select('*').eq('tenant_id', ctx.tenantId).gte('created_at', desdeIso),
    ctx.db.from('reprocesos').select('*').eq('tenant_id', ctx.tenantId).gte('abierto_at', desdeIso),
  ]);
  throwIf(a.error); throwIf(b.error);
  return { reprogramaciones: (a.data ?? []) as Reprogramacion[], reprocesos: ((b.data ?? []) as Reproceso[]).map((r) => ({ ...r, horas_reproceso: r.horas_reproceso === null ? null : Number(r.horas_reproceso) })) };
}
