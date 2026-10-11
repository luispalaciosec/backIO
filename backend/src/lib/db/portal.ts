/**
 * Datos del portal del cliente: PIN (`portal_pines`, tabla sin políticas: solo service role) y caché del resumen
 * con IA (`portal_resumenes`). Lo usan lib/portal/pin y lib/portal/resumen.
 */
import { serviceClient, throwIf, type FilaInsert } from './client';

export async function getHashPin(clienteId: string): Promise<string | null> {
  const { data, error } = await serviceClient().from('portal_pines').select('hash').eq('cliente_id', clienteId).maybeSingle();
  throwIf(error);
  return (data as { hash: string } | null)?.hash ?? null;
}

export async function upsertPin(fila: FilaInsert<'portal_pines'>): Promise<void> {
  const { error } = await serviceClient().from('portal_pines').upsert(fila, { onConflict: 'cliente_id' });
  throwIf(error);
}

export async function borrarPin(tenantId: string, clienteId: string): Promise<void> {
  const { error } = await serviceClient().from('portal_pines').delete().eq('cliente_id', clienteId).eq('tenant_id', tenantId);
  throwIf(error);
}

export async function idsClientesConPin(tenantId: string): Promise<string[]> {
  const { data, error } = await serviceClient().from('portal_pines').select('cliente_id').eq('tenant_id', tenantId);
  throwIf(error);
  return ((data ?? []) as { cliente_id: string }[]).map((x) => x.cliente_id);
}

/** id y config de todos los clientes del tenant (service role), para migrar PIN en claro. */
export async function configsClientes(tenantId: string): Promise<{ id: string; config: Record<string, unknown> | null }[]> {
  const { data, error } = await serviceClient().from('clientes').select('id, config').eq('tenant_id', tenantId);
  throwIf(error);
  return (data ?? []) as { id: string; config: Record<string, unknown> | null }[];
}

export async function actualizarConfigCliente(tenantId: string, clienteId: string, config: Record<string, unknown>): Promise<void> {
  const { error } = await serviceClient().from('clientes').update({ config }).eq('id', clienteId).eq('tenant_id', tenantId);
  throwIf(error);
}

export async function getResumenPortal(proyectoId: string) {
  const { data } = await serviceClient().from('portal_resumenes').select('*').eq('proyecto_id', proyectoId).maybeSingle();
  return data;
}

export async function guardarResumenPortal(fila: FilaInsert<'portal_resumenes'>): Promise<void> {
  const { error } = await serviceClient().from('portal_resumenes').upsert(fila);
  throwIf(error);
}
