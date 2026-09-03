import type { Plantilla, PlantillaArbol, PlantillaBloque, PlantillaTarea } from '@backio/shared';
import { type DbCtx, throwIf } from './client';

export async function listPlantillas(ctx: DbCtx): Promise<Plantilla[]> {
  const { data, error } = await ctx.db
    .from('plantillas')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .eq('activa', true)
    .order('nombre');
  throwIf(error);
  return (data ?? []) as Plantilla[];
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
