import { serviceClient, throwIf } from './client';

/** Tenant activo más antiguo: el de Geeks mientras sea el único (webhook de PrometIO, sin sesión). */
export async function tenantPorDefecto(): Promise<string> {
  const { data, error } = await serviceClient().from('tenants').select('id').eq('activo', true).order('created_at').limit(1).single();
  throwIf(error);
  return data!.id;
}
