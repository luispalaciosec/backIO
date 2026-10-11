/** Escrituras de la publicación de actas en Basecamp (lib/mcp/publish). Con el cliente del contexto. */
import { throwIf, type DbCtx, type FilaUpdate } from './client';

/**
 * Reserva el acta para publicarla: marca `publicado_at` solo si sigue en null (update condicional). Devuelve las
 * filas reservadas: vacío si otra llamada la publicó o la reservó antes.
 */
export async function reservarActaParaPublicar(ctx: DbCtx, actaId: string, reservado: string): Promise<{ id: string }[] | null> {
  const { data, error } = await ctx.db
    .from('actas')
    .update({ publicado_at: reservado, publicado_por: ctx.usuarioId })
    .eq('id', actaId)
    .is('publicado_at', null)
    .select('id');
  throwIf(error);
  return data;
}

/** Libera la reserva, solo si sigue siendo la que tomó esta llamada. */
export async function liberarReservaActa(ctx: DbCtx, actaId: string, reservado: string): Promise<void> {
  await ctx.db.from('actas').update({ publicado_at: null, publicado_por: null }).eq('id', actaId).eq('publicado_at', reservado);
}

/** Proyecto Basecamp de los Docs de la agencia (tenants.config.basecamp_docs_project_id). */
export async function basecampDocsProjectId(ctx: DbCtx): Promise<number | null> {
  const { data, error } = await ctx.db.from('tenants').select('config').eq('id', ctx.tenantId).single();
  throwIf(error);
  return (data as { config: { basecamp_docs_project_id?: number } }).config.basecamp_docs_project_id ?? null;
}

export async function guardarBasecampDocActa(ctx: DbCtx, actaId: string, basecampDocId: number): Promise<void> {
  const { error } = await ctx.db.from('actas').update({ basecamp_doc_id: basecampDocId }).eq('id', actaId);
  throwIf(error);
}

/** Marca en la semana la publicación del plan o del acta. */
export async function marcarPublicacionSemana(ctx: DbCtx, semanaId: string, campos: FilaUpdate<'semanas'>): Promise<void> {
  await ctx.db.from('semanas').update(campos).eq('id', semanaId);
}
