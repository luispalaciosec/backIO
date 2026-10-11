/** Registro de ejecuciones de jobs programados (migración 28, B10) y lista de tenants activos para los jobs. */
import { serviceClient, throwIf } from './client';
import { log } from '../logger';

export async function tenantsActivos(): Promise<string[]> {
  const { data, error } = await serviceClient().from('tenants').select('id').eq('activo', true);
  throwIf(error);
  return (data ?? []).map((t) => (t as { id: string }).id);
}

/**
 * Reclama la ventana de un job: la fila (job, ventana) es única, así que solo un proceso la obtiene. Devuelve false si
 * ya se ejecutó (u otra réplica la tomó). Si la tabla no responde, se ejecuta igual: es preferible repetir un job
 * idempotente a no correrlo.
 */
export async function reclamarVentana(job: string, ventana: string): Promise<boolean> {
  const { error } = await serviceClient().from('cron_runs').insert({ job, ventana });
  if (!error) return true;
  if (error.code === '23505') return false;
  log.error('[jobs] cron_runs no disponible; se ejecuta sin registro', job, error.message);
  return true;
}

export async function cerrarVentana(job: string, ventana: string, ok: boolean, detalle: string): Promise<void> {
  const { error } = await serviceClient()
    .from('cron_runs')
    .update({ fin_at: new Date().toISOString(), ok, detalle: detalle.slice(0, 2000) })
    .eq('job', job)
    .eq('ventana', ventana);
  if (error) log.error('[jobs] no se pudo cerrar la ventana', job, ventana, error.message);
}

/** Borra el registro de más de 60 días. */
export async function limpiarCronRuns(): Promise<void> {
  const { error } = await serviceClient()
    .from('cron_runs')
    .delete()
    .lt('inicio_at', new Date(Date.now() - 60 * 86_400_000).toISOString());
  if (error) log.error('[jobs] limpieza de cron_runs', error.message);
}

export async function clientesConBasecamp(tenantId: string): Promise<{ id: string; nombre: string }[]> {
  const { data, error } = await serviceClient()
    .from('clientes')
    .select('id, nombre')
    .eq('tenant_id', tenantId)
    .eq('activo', true)
    .not('basecamp_project_id', 'is', null);
  throwIf(error);
  return (data ?? []) as { id: string; nombre: string }[];
}

/** De las ventanas pedidas, cuáles tienen registro en cron_runs (es decir, el job arrancó). */
export async function ventanasRegistradas(pares: { job: string; ventana: string }[]): Promise<Set<string>> {
  if (!pares.length) return new Set();
  const { data, error } = await serviceClient()
    .from('cron_runs')
    .select('job, ventana')
    .in('job', [...new Set(pares.map((p) => p.job))])
    .in('ventana', [...new Set(pares.map((p) => p.ventana))]);
  throwIf(error);
  return new Set((data ?? []).map((r) => `${r.job}|${r.ventana}`));
}

export interface UltimaCorrida {
  job: string;
  inicio_at: string;
  fin_at: string | null;
  ok: boolean | null;
}

/** Última corrida registrada de cada job (los registros del vigía, «vigia:<job>», quedan fuera). */
export async function ultimasCorridas(): Promise<Map<string, UltimaCorrida>> {
  const { data, error } = await serviceClient()
    .from('cron_runs')
    .select('job, inicio_at, fin_at, ok')
    .not('job', 'like', 'vigia:%')
    .order('inicio_at', { ascending: false })
    .limit(1000);
  throwIf(error);
  const out = new Map<string, UltimaCorrida>();
  for (const r of data ?? []) if (!out.has(r.job)) out.set(r.job, r);
  return out;
}

/** Inicio del registro: la corrida más antigua en cron_runs (antes de eso no hay con qué comparar). */
export async function inicioDelRegistro(): Promise<number | null> {
  const { data, error } = await serviceClient().from('cron_runs').select('inicio_at').order('inicio_at').limit(1).maybeSingle();
  throwIf(error);
  return data ? Date.parse(data.inicio_at) : null;
}
