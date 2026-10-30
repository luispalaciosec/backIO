/** Foto diaria de la salud de los clientes (migración 38, lib/salud_clientes.ts). La escribe el backend (service role). */
import type { Salud } from '@backio/shared';
import { serviceClient, throwIf, type DbCtx } from './client';

/** Último color registrado de cada cliente entre `desde` y antes de `hoy`. */
export async function ultimaSaludPorCliente(ctx: DbCtx, desde: string, hoy: string): Promise<Map<string, Salud>> {
  const { data, error } = await serviceClient()
    .from('cliente_salud')
    .select('cliente_id, fecha, salud')
    .eq('tenant_id', ctx.tenantId)
    .lt('fecha', hoy)
    .gte('fecha', desde)
    .order('fecha', { ascending: false });
  throwIf(error);
  const previo = new Map<string, Salud>();
  for (const p of (data ?? []) as { cliente_id: string; salud: Salud }[]) if (!previo.has(p.cliente_id)) previo.set(p.cliente_id, p.salud);
  return previo;
}

/** Guarda la foto del día; volver a correrla el mismo día la reemplaza. */
export async function guardarSaludDelDia(
  ctx: DbCtx,
  fecha: string,
  fotos: { cliente_id: string; salud: Salud; motivos: string[] }[],
): Promise<void> {
  if (!fotos.length) return;
  const { error } = await serviceClient()
    .from('cliente_salud')
    .upsert(
      fotos.map((f) => ({ tenant_id: ctx.tenantId, cliente_id: f.cliente_id, fecha, salud: f.salud, motivos: f.motivos })),
      { onConflict: 'tenant_id,cliente_id,fecha' },
    );
  throwIf(error);
}

/** Color de cada día de un cliente desde `desde` (RLS: gestión). */
export async function listSaludCliente(ctx: DbCtx, clienteId: string, desde: string): Promise<{ fecha: string; salud: Salud }[]> {
  const { data, error } = await ctx.db
    .from('cliente_salud')
    .select('fecha, salud')
    .eq('tenant_id', ctx.tenantId)
    .eq('cliente_id', clienteId)
    .gte('fecha', desde)
    .order('fecha');
  throwIf(error);
  return (data ?? []) as { fecha: string; salud: Salud }[];
}
