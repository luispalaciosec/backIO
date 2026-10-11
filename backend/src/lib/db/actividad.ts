/**
 * Consultas del día a día (lib/actividad.ts). Service role: las de audit_log, reprogramaciones, reprocesos,
 * usuarios y clientes filtran por tenant_id; requerimientos y proyectos se buscan por ids ya acotados al tenant.
 */
import { type DbCtx, serviceClient, throwIf } from './client';

/** Acciones de usuarios en audit_log entre `desde` y `hasta` (más recientes primero, tope 1000). */
export async function listAuditDelDia(ctx: DbCtx, desde: string, hasta: string, usuarioId?: string | null) {
  let q = serviceClient()
    .from('audit_log')
    .select('id, usuario_id, origen, accion, entidad, entidad_id, detalle, created_at')
    .eq('tenant_id', ctx.tenantId)
    .not('usuario_id', 'is', null)
    .gte('created_at', desde)
    .lte('created_at', hasta)
    .order('created_at', { ascending: false })
    .limit(1000);
  if (usuarioId) q = q.eq('usuario_id', usuarioId);
  const { data, error } = await q;
  throwIf(error);
  return data ?? [];
}

/** Reprogramaciones y reprocesos con persona entre `desde` y `hasta`. Los errores se ignoran (cuentan como vacío). */
export async function listCambiosConPersona(ctx: DbCtx, desde: string, hasta: string, usuarioId?: string | null) {
  const db = serviceClient();
  let r1 = db
    .from('reprogramaciones')
    .select('id, requerimiento_id, fecha_anterior, fecha_nueva, motivo, usuario_id, created_at')
    .eq('tenant_id', ctx.tenantId)
    .not('usuario_id', 'is', null)
    .gte('created_at', desde)
    .lte('created_at', hasta);
  let r2 = db
    .from('reprocesos')
    .select('id, requerimiento_id, origen, motivo, usuario_id, abierto_at')
    .eq('tenant_id', ctx.tenantId)
    .not('usuario_id', 'is', null)
    .gte('abierto_at', desde)
    .lte('abierto_at', hasta);
  if (usuarioId) {
    r1 = r1.eq('usuario_id', usuarioId);
    r2 = r2.eq('usuario_id', usuarioId);
  }
  const [a, b] = await Promise.all([r1, r2]);
  return { reprogramaciones: a.data ?? [], reprocesos: b.data ?? [] };
}

/** Nombres para la línea de tiempo: usuarios, requerimientos y proyectos por id, clientes. Los errores se ignoran. */
export async function nombresActividad(ctx: DbCtx, requerimientoIds: string[], proyectoIds: string[]) {
  const db = serviceClient();
  const [us, rq, pr, cl] = await Promise.all([
    db.from('usuarios').select('id, nombre, avatar_url, rol').eq('tenant_id', ctx.tenantId),
    requerimientoIds.length
      ? db.from('requerimientos').select('id, titulo_interno, cliente_id, proyecto_id').in('id', requerimientoIds)
      : Promise.resolve({ data: [] }),
    proyectoIds.length ? db.from('proyectos').select('id, nombre, cliente_id').in('id', proyectoIds) : Promise.resolve({ data: [] }),
    db.from('clientes').select('id, nombre').eq('tenant_id', ctx.tenantId),
  ]);
  return {
    usuarios: us.data ?? [],
    requerimientos: rq.data ?? [],
    proyectos: pr.data ?? [],
    clientes: cl.data ?? [],
  };
}
