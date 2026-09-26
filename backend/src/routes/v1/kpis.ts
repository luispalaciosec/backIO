/**
 * KPIs por persona y por equipo (docs/19-kpis.md).
 * Ver: roles de gestión. Registrar mediciones: admin, gerencia, operaciones. Catálogo: solo admin.
 */
import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { ROLES_INTERNOS_GESTION, type Rol } from '@backio/shared';
import { ctxOf, requireScope } from '../../lib/auth/middleware';
import { audit } from '../../lib/db/audit';
import { listDefiniciones, guardarDefinicion, guardarMedicion, borrarMedicion, listMediciones } from '../../lib/db/kpis';
import { tableroKpis, detalleKpi, exportarCsv, periodoMes, periodoDeKpi, periodosAnteriores } from '../../lib/kpis';

export const kpis = new Hono();

const ROLES_REGISTRO: Rol[] = ['admin', 'gerencia', 'operaciones'];
const soloRoles = (roles: readonly Rol[], scope: 'read:capacidad' | 'admin'): MiddlewareHandler => async (c, next) => {
  const a = c.get('auth');
  if (a.tipo === 'usuario' && a.perfil !== 'oauth') {
    if (!a.rol || !roles.includes(a.rol)) return c.json({ error: 'No tienes acceso a los KPIs' }, 403);
    return next();
  }
  return requireScope(scope)(c, next);
};
const verKpis = soloRoles(ROLES_INTERNOS_GESTION, 'read:capacidad');
const registrarKpis = soloRoles(ROLES_REGISTRO, 'admin');
const adminKpis = soloRoles(['admin'], 'admin');

const mesValido = (m: string | undefined) => (m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : periodoMes());

kpis.get('/', verKpis, async (c) => c.json(await tableroKpis(ctxOf(c), mesValido(c.req.query('periodo')))));

/**
 * «Mis KPIs»: cualquier usuario ve SOLO su ficha (su área, su fila y el agregado del equipo, sin otras personas).
 * Así un colaborador entiende cómo se le mide sin ver el rendimiento de sus compañeros.
 */
kpis.get('/mios', async (c) => {
  const a = c.get('auth'); const ctx = ctxOf(c);
  if (a.tipo !== 'usuario' || !ctx.usuarioId) return c.json({ error: 'Solo para usuarios' }, 403);
  const t = await tableroKpis(ctx, mesValido(c.req.query('periodo')));
  const areas = t.areas
    .filter((x) => x.kpis.some((k) => k.personas.some((p) => p.usuario_id === ctx.usuarioId)))
    .map((x) => ({ ...x, kpis: x.kpis.map((k) => ({ ...k, personas: k.personas.filter((p) => p.usuario_id === ctx.usuarioId) })) }));
  return c.json({ ...t, areas, sin_area: [] });
});

kpis.get('/definiciones', verKpis, async (c) => c.json({ items: await listDefiniciones(ctxOf(c)) }));

kpis.put('/definiciones/:codigo', adminKpis, zValidator('json', z.object({
  indicador: z.string().min(3).max(200).optional(),
  periodicidad: z.enum(['mensual', 'trimestral']).optional(),
  operador: z.enum(['>=', '<=']).optional(),
  meta: z.number().min(0).max(100).optional(),
  numerador_label: z.string().max(300).optional(),
  denominador_label: z.string().max(300).optional(),
  denominador_fijo: z.number().positive().nullable().optional(),
  calculo: z.enum(['a_tiempo', 'retrabajo', 'levantamiento', 'aprobacion_primera', 'propuestas_aprobadas', 'sla_respuesta', 'sla_incidencia', 'proactividad', 'manual']).optional(),
  fuente: z.string().max(200).nullable().optional(),
  regla: z.string().max(1000).nullable().optional(),
  formula: z.string().max(1000).nullable().optional(),
  activo: z.boolean().optional(),
})), async (c) => {
  const ctx = ctxOf(c); const patch = c.req.valid('json');
  const d = await guardarDefinicion(ctx, c.req.param('codigo'), patch);
  await audit(ctx, { accion: 'kpi_definicion', entidad: 'kpi', entidad_id: d.id, detalle: { codigo: d.codigo, ...patch } });
  return c.json(d);
});

kpis.get('/export', verKpis, async (c) => {
  const hasta = mesValido(c.req.query('hasta'));
  const n = Math.min(12, Math.max(1, Number(c.req.query('meses') ?? 1) || 1));
  const csv = await exportarCsv(ctxOf(c), periodosAnteriores(hasta, n));
  return c.body(`﻿${csv}`, 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="kpis-${hasta}.csv"` });
});

/** Detalle: gestión ve cualquiera; el resto solo su propio detalle (usuario = uno mismo). */
const verDetalle: MiddlewareHandler = async (c, next) => {
  const a = c.get('auth');
  if (a.tipo === 'usuario' && a.perfil !== 'oauth' && a.rol && !ROLES_INTERNOS_GESTION.includes(a.rol)) {
    if (c.req.query('usuario') !== ctxOf(c).usuarioId) return c.json({ error: 'Solo puedes ver tus propios KPIs' }, 403);
    return next();
  }
  return verKpis(c, next);
};

kpis.get('/:codigo', verDetalle, async (c) => {
  try { return c.json(await detalleKpi(ctxOf(c), c.req.param('codigo'), mesValido(c.req.query('periodo')), c.req.query('usuario') || undefined)); }
  catch (err) { return c.json({ error: err instanceof Error ? err.message : String(err) }, 404); }
});

/** Registra o ajusta la medición de un KPI (persona o equipo) en su periodo. */
kpis.put('/:codigo/mediciones', registrarKpis, zValidator('json', z.object({
  mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  usuario_id: z.string().uuid().nullable(),
  dato_a: z.number().min(0).nullable().optional(),
  dato_b: z.number().min(0).nullable().optional(),
  justificacion_ajuste: z.string().trim().max(1000).nullable().optional(),
  tasa_respuesta: z.number().min(0).max(1).nullable().optional(),
  causa: z.string().trim().max(2000).nullable().optional(),
  atribuible: z.enum(['equipo', 'cliente', 'externo']).nullable().optional(),
  evidencia_url: z.string().url().max(1000).nullable().optional().or(z.literal('')),
  plan_mejora: z.string().trim().max(2000).nullable().optional(),
  responsable_id: z.string().uuid().nullable().optional(),
  fecha_seguimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})), async (c) => {
  const ctx = ctxOf(c); const b = c.req.valid('json');
  const def = (await listDefiniciones(ctx)).find((x) => x.codigo === c.req.param('codigo'));
  if (!def) return c.json({ error: 'KPI no encontrado' }, 404);
  const periodo = periodoDeKpi(def, b.mes);
  const cambiaDatos = b.dato_a !== undefined || b.dato_b !== undefined;
  // Ajustar un automático exige justificación; en un manual los datos son la medición misma.
  let origen: 'manual' | 'ajustado' | 'auto' | undefined;
  if (cambiaDatos) {
    if (def.calculo === 'manual') origen = 'manual';
    else {
      if (!b.justificacion_ajuste) return c.json({ error: 'Para corregir un KPI automático indica la justificación del ajuste.' }, 422);
      origen = 'ajustado';
    }
  }
  const previa = (await listMediciones(ctx, [periodo])).find((m) => m.kpi_id === def.id && m.usuario_id === b.usuario_id);
  const { mes: _mes, ...campos } = b;
  const m = await guardarMedicion(ctx, {
    ...campos, evidencia_url: campos.evidencia_url || null, kpi_id: def.id, periodo, usuario_id: b.usuario_id,
    origen: origen ?? previa?.origen ?? (def.calculo === 'manual' ? 'manual' : 'auto'),
  });
  await audit(ctx, { accion: 'kpi_medicion', entidad: 'kpi', entidad_id: def.id, detalle: { codigo: def.codigo, periodo, usuario_id: b.usuario_id, origen: m.origen, dato_a: m.dato_a, dato_b: m.dato_b } });
  return c.json(m);
});

/** Quita un ajuste o una medición manual (vuelve al cálculo automático). */
kpis.delete('/:codigo/mediciones/:id', registrarKpis, async (c) => {
  const ctx = ctxOf(c);
  await borrarMedicion(ctx, c.req.param('id'));
  await audit(ctx, { accion: 'kpi_medicion_borrar', entidad: 'kpi', entidad_id: c.req.param('id'), detalle: { codigo: c.req.param('codigo') } });
  return c.body(null, 204);
});
