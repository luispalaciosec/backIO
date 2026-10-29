import type { Semana, Senal, Acuerdo, Acta } from '@backio/shared';
import { type DbCtx, throwIf } from './client';

export async function ensureSemana(ctx: DbCtx, fecha: string): Promise<Semana> {
  const { data: id, error } = await ctx.db.rpc('ensure_semana', { p_tenant: ctx.tenantId, p_fecha: fecha });
  throwIf(error);
  const { data, error: e2 } = await ctx.db
    .from('semanas')
    .select('*')
    .eq('id', id as string)
    .single();
  throwIf(e2);
  return data as Semana;
}

export async function getSemana(ctx: DbCtx, id: string): Promise<Semana | null> {
  const { data, error } = await ctx.db.from('semanas').select('*').eq('tenant_id', ctx.tenantId).eq('id', id).maybeSingle();
  throwIf(error);
  return (data as Semana) ?? null;
}

export async function listSenales(ctx: DbCtx, semanaId: string, tipos?: string[]): Promise<Senal[]> {
  let q = ctx.db.from('senales').select('*').eq('tenant_id', ctx.tenantId).eq('semana_id', semanaId);
  if (tipos?.length) q = q.in('tipo', tipos);
  const { data, error } = await q.order('severidad').order('created_at');
  throwIf(error);
  const orden = { critica: 0, alta: 1, media: 2 } as const;
  return ((data ?? []) as Senal[]).sort((a, b) => orden[a.severidad] - orden[b.severidad]);
}

export async function replaceSenales(
  ctx: DbCtx,
  semanaId: string,
  senales: Omit<Senal, 'id' | 'tenant_id' | 'semana_id' | 'created_at' | 'atendida'>[],
): Promise<Senal[]> {
  // Se recalculan completas cada corrida. Una señal atendida (esta semana o la anterior) sigue atendida mientras no
  // empeore su severidad: así no vuelve cada semana como nueva (migración 35).
  const atendidas = await atendidasRecientes(ctx);

  const { error: ed } = await ctx.db.from('senales').delete().eq('tenant_id', ctx.tenantId).eq('semana_id', semanaId);
  throwIf(ed);
  if (senales.length === 0) return [];
  const { data, error } = await ctx.db
    .from('senales')
    .insert(
      senales.map((s) => {
        const a = atendidaVigente(atendidas, s);
        return {
          ...s,
          tenant_id: ctx.tenantId,
          semana_id: semanaId,
          atendida: !!a,
          atendida_por: a?.atendida_por ?? null,
          atendida_at: a?.atendida_at ?? null,
        };
      }),
    )
    .select();
  throwIf(error);
  return (data ?? []) as Senal[];
}

const ORDEN_SEVERIDAD = { critica: 0, alta: 1, media: 2 } as const;
type Atendida = { severidad: Senal['severidad']; atendida_por: string | null; atendida_at: string | null };

/**
 * Señales marcadas como atendidas en los últimos 14 días, la más reciente por (tipo, entidad). Cuenta desde que se
 * marcó (`atendida_at`), no desde que se creó la fila: cada recálculo vuelve a insertar las señales y con `created_at`
 * la atención no vencía nunca (revisión del 28/10/2026).
 */
export async function atendidasRecientes(ctx: DbCtx): Promise<Map<string, Atendida>> {
  const { data, error } = await ctx.db
    .from('senales')
    .select('tipo, entidad_id, severidad, atendida_por, atendida_at')
    .eq('tenant_id', ctx.tenantId)
    .eq('atendida', true)
    .gte('atendida_at', new Date(Date.now() - 14 * 86_400_000).toISOString())
    .order('atendida_at');
  throwIf(error);
  return new Map(
    (data ?? []).map((s) => [
      `${s.tipo}:${s.entidad_id}`,
      { severidad: s.severidad as Senal['severidad'], atendida_por: s.atendida_por, atendida_at: s.atendida_at },
    ]),
  );
}

/** La atención sigue valiendo si la señal no empeoró (misma severidad o menor). */
export function atendidaVigente(atendidas: Map<string, Atendida>, s: Pick<Senal, 'tipo' | 'entidad_id' | 'severidad'>): Atendida | null {
  const a = atendidas.get(`${s.tipo}:${s.entidad_id}`);
  return a && ORDEN_SEVERIDAD[s.severidad] >= ORDEN_SEVERIDAD[a.severidad] ? a : null;
}

/**
 * Marca (o desmarca) una señal como atendida por su clave (tipo + entidad) en la semana: las señales de una mesa se
 * calculan al vuelo y pueden no tener fila guardada; entonces se guarda con los datos que trae.
 */
export async function marcarSenalAtendida(
  ctx: DbCtx,
  semanaId: string,
  s: Pick<Senal, 'tipo' | 'severidad' | 'entidad_tipo' | 'entidad_id' | 'titulo' | 'detalle'>,
  atendida: boolean,
): Promise<void> {
  const marca = atendida
    ? { atendida: true, atendida_por: ctx.usuarioId, atendida_at: new Date().toISOString() }
    : { atendida: false, atendida_por: null, atendida_at: null };
  const { data, error } = await ctx.db
    .from('senales')
    .update(marca)
    .eq('tenant_id', ctx.tenantId)
    .eq('semana_id', semanaId)
    .eq('tipo', s.tipo)
    .eq('entidad_id', s.entidad_id)
    .select('id');
  throwIf(error);
  // Reabrir vale para todas las semanas: si no, la atención de la semana anterior la volvía a mostrar atendida.
  if (!atendida) {
    const { error: er } = await ctx.db
      .from('senales')
      .update(marca)
      .eq('tenant_id', ctx.tenantId)
      .eq('tipo', s.tipo)
      .eq('entidad_id', s.entidad_id)
      .eq('atendida', true);
    throwIf(er);
    return;
  }
  if ((data ?? []).length > 0) return;
  const { error: ei } = await ctx.db.from('senales').insert({ ...s, ...marca, tenant_id: ctx.tenantId, semana_id: semanaId });
  throwIf(ei);
}

export async function listAcuerdosAbiertos(ctx: DbCtx): Promise<Acuerdo[]> {
  const { data, error } = await ctx.db
    .from('acuerdos')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .eq('estado', 'pendiente')
    .order('fecha_compromiso');
  throwIf(error);
  return (data ?? []) as Acuerdo[];
}

export async function listAcuerdosSemana(ctx: DbCtx, semanaId: string): Promise<Acuerdo[]> {
  const { data, error } = await ctx.db
    .from('acuerdos')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .eq('semana_id', semanaId)
    .order('fecha_compromiso');
  throwIf(error);
  return (data ?? []) as Acuerdo[];
}

export async function insertAcuerdo(
  ctx: DbCtx,
  a: { semana_id: string; descripcion: string; responsable_id: string; fecha_compromiso: string; mesa_id?: string | null },
): Promise<Acuerdo> {
  const { data, error } = await ctx.db
    .from('acuerdos')
    .insert({ ...a, tenant_id: ctx.tenantId, created_by: ctx.usuarioId })
    .select()
    .single();
  throwIf(error);
  return data as Acuerdo;
}

export async function cerrarAcuerdo(ctx: DbCtx, id: string, estado: 'cumplido' | 'cancelado'): Promise<void> {
  const { error } = await ctx.db
    .from('acuerdos')
    .update({ estado, cerrado_at: new Date().toISOString() })
    .eq('tenant_id', ctx.tenantId)
    .eq('id', id);
  throwIf(error);
}

/**
 * Guarda un acta generada. Si la semana ya tiene una sin publicar del mismo tipo y mesa, la reemplaza: antes cada clic
 * en «Generar» dejaba un acta nueva (revisión del 29/10/2026). Una ya publicada no se toca; entonces se crea otra.
 */
export async function insertActa(
  ctx: DbCtx,
  a: { semana_id: string; tipo: Acta['tipo']; mesa_id?: string | null; contenido: unknown; markdown: string },
): Promise<Acta> {
  let previa = ctx.db
    .from('actas')
    .select('id')
    .eq('tenant_id', ctx.tenantId)
    .eq('semana_id', a.semana_id)
    .eq('tipo', a.tipo)
    .is('publicado_at', null);
  previa = a.mesa_id ? previa.eq('mesa_id', a.mesa_id) : previa.is('mesa_id', null);
  const { data: borrador, error: e1 } = await previa.order('created_at', { ascending: false }).limit(1).maybeSingle();
  throwIf(e1);
  if (borrador) {
    // Condicional: si alguien la publicó entre la lectura y ahora, no se pisa y se crea una nueva.
    const { data, error } = await ctx.db
      .from('actas')
      .update({ contenido: a.contenido, markdown: a.markdown, created_at: new Date().toISOString() })
      .eq('tenant_id', ctx.tenantId)
      .eq('id', borrador.id)
      .is('publicado_at', null)
      .select()
      .maybeSingle();
    throwIf(error);
    if (data) return data as Acta;
  }
  const { data, error } = await ctx.db
    .from('actas')
    .insert({ ...a, tenant_id: ctx.tenantId })
    .select()
    .single();
  throwIf(error);
  return data as Acta;
}

export async function getActa(ctx: DbCtx, id: string): Promise<Acta | null> {
  const { data, error } = await ctx.db.from('actas').select('*').eq('tenant_id', ctx.tenantId).eq('id', id).maybeSingle();
  throwIf(error);
  return (data as Acta) ?? null;
}

/** ¿La semana ya tiene un Plan Operativo generado? */
export async function semanaTienePlan(ctx: DbCtx, semanaId: string): Promise<boolean> {
  const { count, error } = await ctx.db
    .from('actas')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', ctx.tenantId)
    .eq('semana_id', semanaId)
    .eq('tipo', 'plan_operativo');
  throwIf(error);
  return (count ?? 0) > 0;
}

export async function listInformesMensuales(ctx: DbCtx) {
  const { data, error } = await ctx.db
    .from('actas')
    .select('id, tipo, mesa_id, semana_id, markdown, publicado_at, created_at')
    .eq('tenant_id', ctx.tenantId)
    .eq('tipo', 'informe_mensual')
    .order('created_at', { ascending: false })
    .limit(24);
  throwIf(error);
  return data ?? [];
}
