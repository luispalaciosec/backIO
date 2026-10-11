/** Sondas de salud contra la base (Admin → Servicios). */
import { serviceClient } from './client';

/** Consulta mínima con service role para medir la latencia de Supabase DB. Lanza con el mensaje de Postgrest si falla. */
export async function pingTenant(tenantId: string): Promise<void> {
  const { error } = await serviceClient().from('tenants').select('id').eq('id', tenantId).limit(1);
  if (error) throw new Error(error.message);
}
