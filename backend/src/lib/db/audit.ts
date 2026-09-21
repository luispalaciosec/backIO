import { serviceClient, type DbCtx } from './client';

export interface AuditEntry {
  accion: string;
  entidad: string;
  entidad_id?: string | null;
  detalle?: unknown;
}

const ESCRITURAS = new Map<string, number[]>();
const LECTURA = new Set(['mcp_plan']);

export async function audit(ctx: DbCtx, e: AuditEntry): Promise<void> {
  // Alerta: una API key con >20 escrituras en 5 min (docs/07).
  if (ctx.apiKeyId && !LECTURA.has(e.accion)) {
    const ahora = Date.now();
    const arr = (ESCRITURAS.get(ctx.apiKeyId) ?? []).filter((t) => ahora - t < 5 * 60_000);
    arr.push(ahora);
    ESCRITURAS.set(ctx.apiKeyId, arr);
    if (arr.length === 21) {
      console.warn(`[alerta] API key ${ctx.apiKeyId} superó 20 escrituras en 5 minutos`);
      void ctx.db.from('notificaciones').insert({ tenant_id: ctx.tenantId, usuario_id: null, canal: 'pendiente', tipo: 'alerta_api_key', titulo: 'API key con escritura masiva', cuerpo: `La key ${ctx.apiKeyId} ejecutó más de 20 escrituras en 5 minutos.` });
    }
  }
  // La auditoría nunca debe romper la operación principal.
  // Se escribe SIEMPRE con service role: audit_log no tiene política de INSERT para sesiones de usuario
  // (solo lectura para admin), y con el cliente del usuario el insert se rechazaba en silencio.
  try {
    const { error } = await serviceClient().from('audit_log').insert({
      tenant_id: ctx.tenantId,
      usuario_id: ctx.usuarioId,
      api_key_id: ctx.apiKeyId ?? null,
      origen: ctx.origen,
      accion: e.accion,
      entidad: e.entidad,
      entidad_id: e.entidad_id ?? null,
      detalle: e.detalle ?? null,
    });
    if (error) console.error('[audit] insert rechazado', e.accion, error.message);
  } catch (err) {
    console.error('[audit] fallo al registrar', err);
  }
}
