/** Sondas de salud contra la base (Admin → Servicios). */
import { serviceClient } from './client';

/** Consulta mínima con service role para medir la latencia de Supabase DB. Lanza con el mensaje de Postgrest si falla. */
export async function pingTenant(tenantId: string, signal?: AbortSignal): Promise<void> {
  let q = serviceClient().from('tenants').select('id').eq('id', tenantId).limit(1);
  if (signal) q = q.abortSignal(signal);
  const { error } = await q;
  if (error) throw new Error(error.message);
}

/** Consulta mínima a la base para el chequeo profundo (sin tenant: cualquier fila de tenants). */
export async function pingBase(signal: AbortSignal): Promise<void> {
  const { error } = await serviceClient().from('tenants').select('id').limit(1).abortSignal(signal);
  if (error) throw new Error(error.message);
}

/** Cuándo empezó la última corrida de un job programado (cron_runs). */
export async function ultimaCorridaDe(job: string, signal: AbortSignal): Promise<string | null> {
  const { data, error } = await serviceClient()
    .from('cron_runs')
    .select('inicio_at')
    .eq('job', job)
    .order('inicio_at', { ascending: false })
    .limit(1)
    .abortSignal(signal)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.inicio_at ?? null;
}
