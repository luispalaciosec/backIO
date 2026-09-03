/**
 * Orquestación de rituales sobre la base: arma el WeekContext, corre el motor,
 * persiste señales y genera documentos.
 */
import type { DbCtx } from '../db/client';
import { listBacklog } from '../db/requerimientos';
import { listUsuarios } from '../db/usuarios';
import { listClientes } from '../db/clientes';
import { ensureSemana, getSemana, listAcuerdosAbiertos, listAcuerdosSemana, listSenales, replaceSenales, insertActa } from '../db/semanas';
import { calcularSenales, type SignalThresholds } from './signals';
import { calcularCapacidad, renderActaCierre, renderPlanOperativo } from './documents';
import { fechaLocal } from './daily';
import { throwIf } from '../db/client';
import type { Senal, Acta, CapacidadPersona } from '@backio/shared';

async function umbrales(ctx: DbCtx): Promise<Partial<SignalThresholds>> {
  const { data, error } = await ctx.db.from('tenants').select('config').eq('id', ctx.tenantId).single();
  throwIf(error);
  return ((data as { config: { signal_thresholds?: Partial<SignalThresholds> } }).config.signal_thresholds) ?? {};
}

export async function recalcularSenales(ctx: DbCtx, semanaId?: string): Promise<Senal[]> {
  const hoy = fechaLocal();
  const semana = semanaId ? await getSemana(ctx, semanaId) : await ensureSemana(ctx, hoy);
  if (!semana) throw new Error('Semana no encontrada');
  const [activos, usuarios, clientes, acuerdosAbiertos, u] = await Promise.all([
    listBacklog(ctx, { solo_activos: true }),
    listUsuarios(ctx),
    listClientes(ctx),
    listAcuerdosAbiertos(ctx),
    umbrales(ctx),
  ]);
  const { data: completados } = await ctx.db
    .from('requerimientos')
    .select('cliente_id, completado_at')
    .eq('tenant_id', ctx.tenantId)
    .eq('estado_operativo', 'completado')
    .gte('completado_at', new Date(Date.now() - 30 * 86_400_000).toISOString());
  const senales = calcularSenales({
    hoy,
    semana: { fecha_inicio: semana.fecha_inicio, fecha_fin: semana.fecha_fin },
    activos,
    completadosRecientes: (completados ?? []) as { cliente_id: string; completado_at: string | null }[],
    usuarios,
    clientes,
    acuerdosAbiertos,
    umbrales: u,
  });
  return replaceSenales(ctx, semana.id, senales);
}

export async function capacidadSemana(ctx: DbCtx, semanaId: string): Promise<CapacidadPersona[]> {
  const semana = await getSemana(ctx, semanaId);
  if (!semana) throw new Error('Semana no encontrada');
  const [reqs, usuarios] = await Promise.all([
    listBacklog(ctx, { solo_activos: true, desde: semana.fecha_inicio, hasta: semana.fecha_fin }),
    listUsuarios(ctx),
  ]);
  return calcularCapacidad(reqs, usuarios);
}

export async function generarPlanOperativo(ctx: DbCtx, semanaId: string): Promise<Acta> {
  const semana = await getSemana(ctx, semanaId);
  if (!semana) throw new Error('Semana no encontrada');
  const [prioridades, usuarios, clientes, pendientes, riesgos] = await Promise.all([
    listBacklog(ctx, { solo_activos: true, desde: semana.fecha_inicio, hasta: semana.fecha_fin }),
    listUsuarios(ctx),
    listClientes(ctx),
    listAcuerdosAbiertos(ctx),
    listSenales(ctx, semanaId, ['bloqueo_cliente', 'sobrecarga_proyectada', 'concentracion_carga']),
  ]);
  const data = { semana, capacidad: calcularCapacidad(prioridades, usuarios), prioridades, riesgos, pendientes_anteriores: pendientes, usuarios, clientes };
  return insertActa(ctx, { semana_id: semanaId, tipo: 'plan_operativo', contenido: data, markdown: renderPlanOperativo(data) });
}

export async function generarActaCierre(ctx: DbCtx, semanaId: string): Promise<Acta> {
  const semana = await getSemana(ctx, semanaId);
  if (!semana) throw new Error('Semana no encontrada');
  const [prioridades, usuarios, clientes, pendientes, senales, acuerdos] = await Promise.all([
    listBacklog(ctx, { desde: semana.fecha_inicio, hasta: semana.fecha_fin }),
    listUsuarios(ctx),
    listClientes(ctx),
    listAcuerdosAbiertos(ctx),
    listSenales(ctx, semanaId),
    listAcuerdosSemana(ctx, semanaId),
  ]);
  const data = { semana, capacidad: calcularCapacidad(prioridades, usuarios), prioridades, riesgos: [], pendientes_anteriores: pendientes, usuarios, clientes, senales, acuerdos_semana: acuerdos };
  return insertActa(ctx, { semana_id: semanaId, tipo: 'cierre', contenido: data, markdown: renderActaCierre(data) });
}
