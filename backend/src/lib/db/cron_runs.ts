/** Registro de ejecuciones de jobs programados (migración 28, B10) y lista de tenants activos para los jobs. */
import { serviceClient, throwIf } from './client';

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
  console.error('[jobs] cron_runs no disponible; se ejecuta sin registro', job, error.message);
  return true;
}

export async function cerrarVentana(job: string, ventana: string, ok: boolean, detalle: string): Promise<void> {
  const { error } = await serviceClient()
    .from('cron_runs')
    .update({ fin_at: new Date().toISOString(), ok, detalle: detalle.slice(0, 2000) })
    .eq('job', job)
    .eq('ventana', ventana);
  if (error) console.error('[jobs] no se pudo cerrar la ventana', job, ventana, error.message);
}

/** Borra el registro de más de 60 días. */
export async function limpiarCronRuns(): Promise<void> {
  const { error } = await serviceClient()
    .from('cron_runs')
    .delete()
    .lt('inicio_at', new Date(Date.now() - 60 * 86_400_000).toISOString());
  if (error) console.error('[jobs] limpieza de cron_runs', error.message);
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
