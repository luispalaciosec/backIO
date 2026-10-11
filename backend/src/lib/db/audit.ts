import { serviceClient, throwIf, type DbCtx } from './client';
import { notificar } from '../notificaciones';

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
      // Antes era un insert sin await (el builder es perezoso: nunca salía) y con usuario_id null (no se despachaba).
      void notificar(
        ctx,
        {
          tipo: 'alerta_api_key',
          titulo: 'API key con escritura masiva',
          cuerpo: `La key ${ctx.apiKeyId} ejecutó más de 20 escrituras en 5 minutos. Revisa Admin → API keys.`,
          ruta: '/admin/api-keys',
        },
        { roles: ['admin', 'operaciones'] },
      ).catch((err) => console.error('[alerta] no se pudo notificar', err instanceof Error ? err.message : err));
    }
  }
  // La auditoría nunca debe romper la operación principal.
  // Se escribe SIEMPRE con service role: audit_log no tiene política de INSERT para sesiones de usuario
  // (solo lectura para admin), y con el cliente del usuario el insert se rechazaba en silencio.
  try {
    const { error } = await serviceClient()
      .from('audit_log')
      .insert({
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

/**
 * Entradas desde Basecamp (accion basecamp_entrada) de los últimos días que nadie marcó como revisadas.
 * audit_log no tiene política de lectura para usuarios: se lee con service role, acotado al tenant.
 */
export async function entradasBasecampSinRevisar(
  ctx: DbCtx,
  desdeIso: string,
): Promise<{ entidad_id: string; created_at: string; detalle: Record<string, unknown> }[]> {
  const svc = serviceClient();
  const { data: ent, error } = await svc
    .from('audit_log')
    .select('entidad_id, created_at, detalle')
    .eq('tenant_id', ctx.tenantId)
    .eq('accion', 'basecamp_entrada')
    .gte('created_at', desdeIso)
    .order('created_at', { ascending: false })
    .limit(500);
  throwIf(error);
  const entradas = (ent ?? []).filter((e): e is typeof e & { entidad_id: string } => !!e.entidad_id);
  if (!entradas.length) return [];
  const { data: rev, error: e2 } = await svc
    .from('audit_log')
    .select('entidad_id')
    .eq('tenant_id', ctx.tenantId)
    .eq('accion', 'revisar_entrada')
    .in(
      'entidad_id',
      entradas.map((e) => e.entidad_id),
    );
  throwIf(e2);
  const revisadas = new Set((rev ?? []).map((r) => r.entidad_id));
  return entradas
    .filter((e) => !revisadas.has(e.entidad_id))
    .map((e) => ({ entidad_id: e.entidad_id, created_at: e.created_at, detalle: (e.detalle ?? {}) as Record<string, unknown> }));
}
