import type { Plantilla, PlantillaArbol, PlantillaBloque, PlantillaTarea } from '@backio/shared';
import { type DbCtx, throwIf, DbError } from './client';

export async function listPlantillas(ctx: DbCtx, opts: { clienteId?: string | null; incluirInactivas?: boolean } = {}): Promise<Plantilla[]> {
  let q = ctx.db.from('plantillas').select('*').eq('tenant_id', ctx.tenantId).order('pilar').order('nombre');
  if (!opts.incluirInactivas) q = q.eq('activa', true);
  // Generales (cliente_id null) + las propias del cliente pedido.
  if (opts.clienteId) q = q.or(`cliente_id.is.null,cliente_id.eq.${opts.clienteId}`);
  else if (opts.clienteId === null) q = q.is('cliente_id', null);
  const { data, error } = await q;
  throwIf(error);
  return (data ?? []) as Plantilla[];
}

export interface PlantillaInput {
  id?: string;
  nombre: string;
  descripcion?: string | null;
  tipo: Plantilla['tipo'];
  pilar?: Plantilla['pilar'];
  familia?: string | null;
  unidad?: string | null;
  precio_referencia?: string | null;
  cliente_id?: string | null;
  recurrente?: boolean;
  patron_nombre?: string | null;
  activa?: boolean;
  bloques: { nombre: string; peso: number; opcional: boolean; tareas: { titulo_interno: string; etiqueta_cliente: string | null; visible_cliente_default: boolean; peso_relativo: number; dias_offset: number; rol_sugerido: string | null }[] }[];
}

/** Crea o reemplaza una plantilla completa (bloques y tareas se regeneran). */
export async function guardarPlantilla(ctx: DbCtx, input: PlantillaInput): Promise<PlantillaArbol> {
  const suma = input.bloques.reduce((s, b) => s + b.peso, 0);
  if (input.bloques.length && Math.abs(suma - 100) > 0.5) throw new DbError(`Los pesos de los bloques suman ${suma}, deben sumar 100`, 422);
  for (const b of input.bloques) for (const t of b.tareas) if (t.visible_cliente_default && !t.etiqueta_cliente) throw new DbError(`"${t.titulo_interno}": visible al cliente requiere etiqueta`, 422);
  const { bloques, id, ...cab } = input;
  const { data, error } = await ctx.db
    .from('plantillas')
    .upsert({ ...(id ? { id } : {}), ...cab, tenant_id: ctx.tenantId }, { onConflict: id ? 'id' : 'tenant_id,nombre' })
    .select().single();
  throwIf(error);
  const pl = data as Plantilla;
  const { error: ed } = await ctx.db.from('plantilla_bloques').delete().eq('plantilla_id', pl.id);
  throwIf(ed);
  for (const [i, b] of bloques.entries()) {
    const { data: bl, error: eb } = await ctx.db.from('plantilla_bloques').insert({ tenant_id: ctx.tenantId, plantilla_id: pl.id, nombre: b.nombre, peso: b.peso, orden: i + 1, opcional: b.opcional }).select('id').single();
    throwIf(eb);
    if (b.tareas.length) {
      const { error: et } = await ctx.db.from('plantilla_tareas').insert(b.tareas.map((t, j) => ({ tenant_id: ctx.tenantId, bloque_id: (bl as { id: string }).id, ...t, orden: j + 1 })));
      throwIf(et);
    }
  }
  return (await getPlantillaArbol(ctx, pl.id))!;
}

export async function getPlantillaArbol(ctx: DbCtx, id: string): Promise<PlantillaArbol | null> {
  const { data: p, error } = await ctx.db
    .from('plantillas')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .eq('id', id)
    .maybeSingle();
  throwIf(error);
  if (!p) return null;

  const { data: bloques, error: eb } = await ctx.db
    .from('plantilla_bloques')
    .select('*')
    .eq('plantilla_id', id)
    .order('orden');
  throwIf(eb);
  const bloqueIds = (bloques ?? []).map((b) => (b as PlantillaBloque).id);

  const { data: tareas, error: et } = bloqueIds.length
    ? await ctx.db.from('plantilla_tareas').select('*').in('bloque_id', bloqueIds).order('orden')
    : { data: [], error: null };
  throwIf(et);

  return {
    ...(p as Plantilla),
    bloques: ((bloques ?? []) as PlantillaBloque[]).map((b) => ({
      ...b,
      peso: Number(b.peso),
      tareas: ((tareas ?? []) as PlantillaTarea[])
        .filter((t) => t.bloque_id === b.id)
        .map((t) => ({ ...t, peso_relativo: Number(t.peso_relativo) })),
    })),
  };
}
