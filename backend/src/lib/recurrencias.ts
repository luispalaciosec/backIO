/**
 * Recurrencia mensual de fees (D2). Decidido 04/09/2026 con las recomendaciones por defecto:
 *  - Se genera el día 25 del mes anterior (configurable 1–28) a las 08:00 Guayaquil.
 *  - Nombre según patron de la plantilla ("… - {mes} {año}"); inicio = día 1, entrega = último día del mes.
 *  - Misma configuración del Builder que el último proyecto (bloques, piezas, owners, brief).
 *  - Pasa por el mismo camino que un proyecto normal: plan, requerimientos, Basecamp, correo a los owners.
 */
import type { Recurrencia, CrearProyectoInput, BloqueAlcanceInput, BriefProyecto } from '@backio/shared';
import type { DbCtx } from './db/client';
import { throwIf, DbError } from './db/client';
import { getProyectoDetalle, updateProyecto } from './db/proyectos';
import { getPlantillaArbol } from './db/plantillas';
import { audit } from './db/audit';
import { notificar } from './notificaciones';
import { crearProyectoDesdePlantilla, type ResultadoCreacion } from './builder/service';
import { fechaLocal } from './rituals/daily';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function rangoPeriodo(periodo: string): { inicio: string; fin: string; mes: string; anio: number } {
  const [y, m] = periodo.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) throw new DbError('Periodo inválido (YYYY-MM)', 400);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { inicio: `${periodo}-01`, fin: `${periodo}-${String(ultimo).padStart(2, '0')}`, mes: MESES[m - 1]!, anio: y };
}
export function periodoSiguiente(periodo: string): string {
  const [y, m] = periodo.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m!, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
export function nombreDelPeriodo(patron: string, periodo: string): string {
  const { mes, anio } = rangoPeriodo(periodo);
  const Mes = mes.charAt(0).toUpperCase() + mes.slice(1);
  return patron.replace(/\{mes\}/gi, Mes).replace(/\{a[ñn]o\}|\{anio\}|\{yyyy\}/gi, String(anio)).replace(/\{MES\}/g, Mes.toUpperCase());
}

export async function listRecurrencias(ctx: DbCtx): Promise<Recurrencia[]> {
  const { data, error } = await ctx.db.from('recurrencias').select('*').eq('tenant_id', ctx.tenantId).order('created_at', { ascending: false });
  throwIf(error); return (data ?? []) as Recurrencia[];
}
export async function getRecurrencia(ctx: DbCtx, id: string): Promise<Recurrencia | null> {
  const { data, error } = await ctx.db.from('recurrencias').select('*').eq('tenant_id', ctx.tenantId).eq('id', id).maybeSingle();
  throwIf(error); return (data as Recurrencia) ?? null;
}

export async function upsertRecurrencia(ctx: DbCtx, r: { cliente_id: string; plantilla_id: string; nombre_patron: string; brief: unknown; bloques: BloqueAlcanceInput[]; owner_ejecutiva: string | null; dia_generacion?: number; proyecto_origen_id?: string | null; ultimo_mes_generado?: string | null; ultimo_proyecto_id?: string | null }): Promise<Recurrencia> {
  const { data, error } = await ctx.db.from('recurrencias').upsert({
    tenant_id: ctx.tenantId, cliente_id: r.cliente_id, plantilla_id: r.plantilla_id, nombre_patron: r.nombre_patron, brief: r.brief, bloques: r.bloques,
    owner_ejecutiva: r.owner_ejecutiva, dia_generacion: r.dia_generacion ?? 25, activa: true, proyecto_origen_id: r.proyecto_origen_id ?? null,
    ultimo_mes_generado: r.ultimo_mes_generado ?? null, ultimo_proyecto_id: r.ultimo_proyecto_id ?? null, created_by: ctx.usuarioId, updated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id,cliente_id,plantilla_id' }).select().single();
  throwIf(error);
  await audit(ctx, { accion: 'recurrencia_guardar', entidad: 'recurrencia', entidad_id: (data as Recurrencia).id, detalle: { cliente_id: r.cliente_id, plantilla_id: r.plantilla_id } });
  return data as Recurrencia;
}
export async function updateRecurrencia(ctx: DbCtx, id: string, patch: Partial<Pick<Recurrencia, 'activa' | 'dia_generacion' | 'nombre_patron' | 'owner_ejecutiva' | 'bloques' | 'brief'>>): Promise<Recurrencia> {
  const { data, error } = await ctx.db.from('recurrencias').update({ ...patch, updated_at: new Date().toISOString() }).eq('tenant_id', ctx.tenantId).eq('id', id).select().single();
  throwIf(error);
  await audit(ctx, { accion: 'recurrencia_actualizar', entidad: 'recurrencia', entidad_id: id, detalle: patch });
  return data as Recurrencia;
}

/** Crea una recurrencia a partir de un proyecto existente, reconstruyendo el alcance desde sus requerimientos. */
export async function recurrenciaDesdeProyecto(ctx: DbCtx, proyectoId: string, dia = 25): Promise<Recurrencia> {
  const det = await getProyectoDetalle(ctx, proyectoId);
  if (!det) throw new DbError('Proyecto no encontrado', 404);
  if (!det.plantilla_id) throw new DbError('El proyecto no nació de una plantilla; crea la recurrencia desde el Builder', 422);
  const plantilla = await getPlantillaArbol(ctx, det.plantilla_id);
  if (!plantilla) throw new DbError('Plantilla no encontrada', 404);
  const bloques: BloqueAlcanceInput[] = plantilla.bloques.map((b) => {
    const reqs = det.requerimientos.filter((r) => r.bloque_nombre === b.nombre);
    const owners = reqs.flatMap((r) => r.owner_agencia);
    const owner = owners.length ? [...owners].sort((a, c) => owners.filter((x) => x === c).length - owners.filter((x) => x === a).length)[0]! : null;
    const piezasPorTipo: Record<string, number> = {};
    for (const r of reqs) if (r.tipo_pieza_id && r.piezas) piezasPorTipo[r.tipo_pieza_id] = Math.max(piezasPorTipo[r.tipo_pieza_id] ?? 0, r.piezas);
    return { bloque_id: b.id, activo: reqs.length > 0 || !b.opcional, owner_id: owner, piezas_por_canal: {}, piezas_por_tipo: piezasPorTipo };
  });
  const brief = (det.brief as { actual?: Partial<BriefProyecto> }).actual ?? {};
  const patron = plantilla.patron_nombre ?? `${plantilla.nombre} - {mes} {año}`;
  return upsertRecurrencia(ctx, { cliente_id: det.cliente_id, plantilla_id: det.plantilla_id, nombre_patron: patron, brief, bloques, owner_ejecutiva: det.owner_ejecutiva, dia_generacion: dia, proyecto_origen_id: det.id, ultimo_mes_generado: det.periodo ?? det.fecha_entrega.slice(0, 7), ultimo_proyecto_id: det.id });
}

/** Genera el proyecto de un periodo concreto. Idempotente: si ya existe un proyecto de esa recurrencia y periodo, lo devuelve. */
export async function generarPeriodo(ctx: DbCtx, rec: Recurrencia, periodo: string): Promise<{ proyecto_id: string; creado: boolean; nombre: string; basecamp?: unknown }> {
  const { data: existente } = await ctx.db.from('proyectos').select('id, nombre').eq('tenant_id', ctx.tenantId).eq('recurrencia_id', rec.id).eq('periodo', periodo).is('deleted_at', null).maybeSingle();
  if (existente) return { proyecto_id: (existente as { id: string }).id, creado: false, nombre: (existente as { nombre: string }).nombre };
  const { inicio, fin } = rangoPeriodo(periodo);
  const nombre = nombreDelPeriodo(rec.nombre_patron, periodo);
  const brief = rec.brief as CrearProyectoInput['brief'];
  const input: CrearProyectoInput = {
    cliente_id: rec.cliente_id, plantilla_id: rec.plantilla_id, nombre,
    brief: { objetivo_negocio: brief.objetivo_negocio ?? `Fee mensual · ${nombre}`, publico_objetivo: brief.publico_objetivo ?? '', canales: brief.canales ?? [], mandatorios_marca: brief.mandatorios_marca, presupuesto_aprobado: brief.presupuesto_aprobado ?? null },
    fecha_inicio: inicio, fecha_entrega: fin, bloques: rec.bloques as BloqueAlcanceInput[], owner_ejecutiva: rec.owner_ejecutiva, periodo,
  };
  const r: ResultadoCreacion = await crearProyectoDesdePlantilla(ctx, input);
  await updateProyecto(ctx, r.proyecto.id, { recurrencia_id: rec.id, periodo });
  const { error } = await ctx.db.from('recurrencias').update({ ultimo_mes_generado: periodo, ultimo_proyecto_id: r.proyecto.id, updated_at: new Date().toISOString() }).eq('id', rec.id);
  throwIf(error);
  await audit(ctx, { accion: 'recurrencia_generar', entidad: 'proyecto', entidad_id: r.proyecto.id, detalle: { recurrencia_id: rec.id, periodo, requerimientos: r.requerimientos.length } });
  const destino = rec.owner_ejecutiva ? { usuarioIds: [rec.owner_ejecutiva], roles: ['operaciones' as const] } : { roles: ['operaciones' as const, 'ejecutiva' as const] };
  void notificar(ctx, {
    tipo: 'recurrencia_generada',
    titulo: `Listo el fee de ${periodo}: ${nombre}`,
    cuerpo: `BackIO creó el proyecto "${nombre}" con ${r.requerimientos.length} tareas y lo envió a Basecamp. Revisa fechas, piezas y responsables antes de que arranque el mes.`,
    ruta: `/proyectos/${r.proyecto.id}`, entidad_tipo: 'proyecto', entidad_id: r.proyecto.id,
  }, destino).catch(() => undefined);
  return { proyecto_id: r.proyecto.id, creado: true, nombre, basecamp: r.basecamp };
}

/** Corre a diario: genera el mes siguiente para cada recurrencia activa cuyo día ya llegó. */
export async function procesarRecurrencias(ctx: DbCtx, hoy = fechaLocal()): Promise<{ revisadas: number; generadas: { nombre: string; periodo: string }[]; errores: string[] }> {
  const recs = (await listRecurrencias(ctx)).filter((r) => r.activa);
  const dia = Number(hoy.slice(8, 10));
  const periodoActual = hoy.slice(0, 7);
  const objetivo = periodoSiguiente(periodoActual);
  const out = { revisadas: recs.length, generadas: [] as { nombre: string; periodo: string }[], errores: [] as string[] };
  for (const rec of recs) {
    if (dia < rec.dia_generacion) continue;
    if (rec.ultimo_mes_generado && rec.ultimo_mes_generado >= objetivo) continue;
    try {
      const g = await generarPeriodo(ctx, rec, objetivo);
      if (g.creado) out.generadas.push({ nombre: g.nombre, periodo: objetivo });
    } catch (err) {
      out.errores.push(`${rec.nombre_patron}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}
