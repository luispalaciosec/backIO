/**
 * Consultas del evolutivo de rituales (lib/evolutivo.ts): tareas de la mesa, historia desde la auditoría y las
 * fotos diarias y semanales. Service role: cada consulta filtra por tenant_id.
 */
import type { TareaEvo } from '../evolutivo';
import { type DbCtx, type FilaInsert, serviceClient, throwIf } from './client';
import { paginar } from './paginar';

/** Tareas vivas del alcance de la mesa. `partes` son los filtros `cliente_id.in.(…)` / `proyecto_id.in.(…)`. */
export async function listTareasEvolutivo(ctx: DbCtx, partes: string[]): Promise<TareaEvo[]> {
  const db = serviceClient();
  return paginar<TareaEvo>((a, b) =>
    db
      .from('requerimientos')
      .select(
        'id, owner_agencia, estado_operativo, completado_at, created_at, planificacion, fecha_entrega, fecha_entrega_original, daily_fecha, fecha_pedido, responsables_cierre, heredada',
      )
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .or(partes.join(','))
      .order('id')
      .range(a, b),
  );
}

export async function listReprocesosDesde(ctx: DbCtx, desdeIso: string) {
  const db = serviceClient();
  return paginar<{ requerimiento_id: string; abierto_at: string }>((a, b) =>
    db
      .from('reprocesos')
      .select('requerimiento_id, abierto_at')
      .eq('tenant_id', ctx.tenantId)
      .gte('abierto_at', desdeIso)
      .order('abierto_at')
      .range(a, b),
  );
}

export async function listReprogramacionesDesde(ctx: DbCtx, desdeIso: string) {
  const db = serviceClient();
  return paginar<{ requerimiento_id: string; created_at: string; motivo: string | null }>((a, b) =>
    db
      .from('reprogramaciones')
      .select('requerimiento_id, created_at, motivo')
      .eq('tenant_id', ctx.tenantId)
      .gte('created_at', desdeIso)
      .order('created_at')
      .range(a, b),
  );
}

/** Cambios de `daily_fecha` registrados en la auditoría (para reconstruir la selección de cada día). */
export async function listEventosDailyFecha(ctx: DbCtx, desdeIso: string) {
  const db = serviceClient();
  return paginar<{ entidad_id: string; created_at: string; detalle: { daily_fecha: string | null } }>((a, b) =>
    db
      .from('audit_log')
      .select('entidad_id, created_at, detalle')
      .eq('tenant_id', ctx.tenantId)
      .eq('entidad', 'requerimiento')
      .in('accion', ['actualizar', 'reprogramar'])
      .not('detalle->daily_fecha', 'is', null)
      .gte('created_at', desdeIso)
      .order('created_at')
      .range(a, b),
  );
}

/** Pasos a «bloqueado» registrados en la auditoría. */
export async function listEventosBloqueo(ctx: DbCtx, desdeIso: string) {
  const db = serviceClient();
  return paginar<{ entidad_id: string; created_at: string }>((a, b) =>
    db
      .from('audit_log')
      .select('entidad_id, created_at')
      .eq('tenant_id', ctx.tenantId)
      .eq('entidad', 'requerimiento')
      .eq('detalle->>estado_operativo', 'bloqueado')
      .gte('created_at', desdeIso)
      .order('created_at')
      .range(a, b),
  );
}

/** Aperturas y cierres del daily publicados para la mesa. */
export async function listPublicacionesDaily(ctx: DbCtx, mesaId: string, desdeIso: string) {
  const db = serviceClient();
  return paginar<{ accion: string; created_at: string; detalle: { message_id?: number } }>((a, b) =>
    db
      .from('audit_log')
      .select('accion, created_at, detalle')
      .eq('tenant_id', ctx.tenantId)
      .eq('entidad_id', mesaId)
      .in('accion', ['publicar_daily_apertura', 'publicar_daily_cierre'])
      .gte('created_at', desdeIso)
      .order('created_at')
      .range(a, b),
  );
}

// ---------------------------------------------------------------- fotos diarias

/** Foto diaria existente de la mesa en `fecha` (el error se ignora: sin foto se inserta una nueva). */
export async function getDailySnapshot(ctx: DbCtx, mesaId: string, fecha: string): Promise<{ id: string; origen: string } | null> {
  const { data } = await serviceClient()
    .from('daily_snapshots')
    .select('id, origen')
    .eq('tenant_id', ctx.tenantId)
    .eq('mesa_id', mesaId)
    .eq('fecha', fecha)
    .maybeSingle();
  return data as { id: string; origen: string } | null;
}

/** Actualiza la foto `existenteId` o inserta una nueva si es null. */
export async function guardarDailySnapshot(existenteId: string | null, fila: FilaInsert<'daily_snapshots'>): Promise<void> {
  const db = serviceClient();
  const { error } = existenteId
    ? await db.from('daily_snapshots').update(fila).eq('id', existenteId).eq('tenant_id', fila.tenant_id)
    : await db.from('daily_snapshots').insert(fila);
  throwIf(error);
}

export async function listDailySnapshots(ctx: DbCtx, mesaId: string, desde: string, hasta: string) {
  const { data, error } = await serviceClient()
    .from('daily_snapshots')
    .select('fecha, metricas, por_persona, origen, publicado, apertura_publicada')
    .eq('tenant_id', ctx.tenantId)
    .eq('mesa_id', mesaId)
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha');
  throwIf(error);
  return data ?? [];
}

// ---------------------------------------------------------------- fotos semanales

/** Foto semanal existente de la mesa (el error se ignora: sin foto se inserta una nueva). */
export async function getWeeklySnapshot(ctx: DbCtx, mesaId: string, semanaId: string): Promise<{ id: string; origen: string } | null> {
  const { data } = await serviceClient()
    .from('weekly_snapshots')
    .select('id, origen')
    .eq('tenant_id', ctx.tenantId)
    .eq('mesa_id', mesaId)
    .eq('semana_id', semanaId)
    .maybeSingle();
  return data as { id: string; origen: string } | null;
}

/** Actualiza la foto `existenteId` o inserta una nueva si es null. */
export async function guardarWeeklySnapshot(existenteId: string | null, fila: FilaInsert<'weekly_snapshots'>): Promise<void> {
  const db = serviceClient();
  const { error } = existenteId
    ? await db.from('weekly_snapshots').update(fila).eq('id', existenteId).eq('tenant_id', fila.tenant_id)
    : await db.from('weekly_snapshots').insert(fila);
  throwIf(error);
}

/** Fotos semanales que se cruzan con el rango [desde, hasta]. */
export async function listWeeklySnapshots(ctx: DbCtx, mesaId: string, desde: string, hasta: string) {
  const { data, error } = await serviceClient()
    .from('weekly_snapshots')
    .select('fecha_inicio, fecha_fin, metricas, origen')
    .eq('tenant_id', ctx.tenantId)
    .eq('mesa_id', mesaId)
    .lte('fecha_inicio', hasta)
    .gte('fecha_fin', desde)
    .order('fecha_inicio');
  throwIf(error);
  return data ?? [];
}

// ---------------------------------------------------------------- semana (señales, acuerdos, plan)

/** Señales y acuerdos de la semana y el último plan operativo de la mesa. Los errores se ignoran (cuentan como vacío). */
export async function datosSemanaMesa(ctx: DbCtx, semanaId: string, mesaId: string) {
  const db = serviceClient();
  const [{ data: sen }, { data: acu }, { data: acta }] = await Promise.all([
    db.from('senales').select('severidad, atendida, entidad_tipo, entidad_id').eq('tenant_id', ctx.tenantId).eq('semana_id', semanaId),
    db.from('acuerdos').select('estado, fecha_compromiso, cerrado_at').eq('tenant_id', ctx.tenantId).eq('semana_id', semanaId),
    db
      .from('actas')
      .select('contenido')
      .eq('tenant_id', ctx.tenantId)
      .eq('semana_id', semanaId)
      .eq('mesa_id', mesaId)
      .eq('tipo', 'plan_operativo')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return { senales: sen, acuerdos: acu, acta };
}
