import type { DbCtx } from './client';

export interface AuditEntry {
  accion: string;
  entidad: string;
  entidad_id?: string | null;
  detalle?: unknown;
}

export async function audit(ctx: DbCtx, e: AuditEntry): Promise<void> {
  // La auditoría nunca debe romper la operación principal.
  try {
    await ctx.db.from('audit_log').insert({
      tenant_id: ctx.tenantId,
      usuario_id: ctx.usuarioId,
      api_key_id: ctx.apiKeyId ?? null,
      origen: ctx.origen,
      accion: e.accion,
      entidad: e.entidad,
      entidad_id: e.entidad_id ?? null,
      detalle: e.detalle ?? null,
    });
  } catch (err) {
    console.error('[audit] fallo al registrar', err);
  }
}
