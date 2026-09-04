import type { Semana, Senal, Acuerdo, Acta } from '@backio/shared';
import { type DbCtx, throwIf } from './client';

export async function ensureSemana(ctx: DbCtx, fecha: string): Promise<Semana> {
  const { data: id, error } = await ctx.db.rpc('ensure_semana', { p_tenant: ctx.tenantId, p_fecha: fecha });
  throwIf(error);
  const { data, error: e2 } = await ctx.db.from('semanas').select('*').eq('id', id as string).single();
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

export async function replaceSenales(ctx: DbCtx, semanaId: string, senales: Omit<Senal, 'id' | 'tenant_id' | 'semana_id' | 'created_at' | 'atendida'>[]): Promise<Senal[]> {
  // Se recalculan completas cada corrida; las atendidas se conservan por (tipo, entidad_id).
  const { data: previas } = await ctx.db
    .from('senales')
    .select('tipo, entidad_id')
    .eq('tenant_id', ctx.tenantId)
    .eq('semana_id', semanaId)
    .eq('atendida', true);
  const atendidas = new Set((previas ?? []).map((p) => `${(p as Senal).tipo}:${(p as Senal).entidad_id}`));

  const { error: ed } = await ctx.db.from('senales').delete().eq('tenant_id', ctx.tenantId).eq('semana_id', semanaId);
  throwIf(ed);
  if (senales.length === 0) return [];
  const { data, error } = await ctx.db
    .from('senales')
    .insert(senales.map((s) => ({ ...s, tenant_id: ctx.tenantId, semana_id: semanaId, atendida: atendidas.has(`${s.tipo}:${s.entidad_id}`) })))
    .select();
  throwIf(error);
  return (data ?? []) as Senal[];
}

export async function marcarSenalAtendida(ctx: DbCtx, id: string, atendida = true): Promise<void> {
  const { error } = await ctx.db.from('senales').update({ atendida }).eq('tenant_id', ctx.tenantId).eq('id', id);
  throwIf(error);
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
  const { data, error } = await ctx.db.from('acuerdos').select('*').eq('tenant_id', ctx.tenantId).eq('semana_id', semanaId).order('fecha_compromiso');
  throwIf(error);
  return (data ?? []) as Acuerdo[];
}

export async function insertAcuerdo(ctx: DbCtx, a: { semana_id: string; descripcion: string; responsable_id: string; fecha_compromiso: string }): Promise<Acuerdo> {
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

export async function insertActa(ctx: DbCtx, a: { semana_id: string; tipo: 'plan_operativo' | 'cierre'; mesa_id?: string | null; contenido: unknown; markdown: string }): Promise<Acta> {
  const { data, error } = await ctx.db.from('actas').insert({ ...a, tenant_id: ctx.tenantId }).select().single();
  throwIf(error);
  return data as Acta;
}

export async function getActa(ctx: DbCtx, id: string): Promise<Acta | null> {
  const { data, error } = await ctx.db.from('actas').select('*').eq('tenant_id', ctx.tenantId).eq('id', id).maybeSingle();
  throwIf(error);
  return (data as Acta) ?? null;
}
