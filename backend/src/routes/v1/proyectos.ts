import { Hono } from 'hono';
import { upsertRecurrencia } from '../../lib/recurrencias';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import { listProyectos, getProyectoDetalle, getProyecto, updateProyecto, audit, DbError, getPlantillaArbol } from '../../lib/db';
import { generarPortalToken } from '../../lib/portal/token';
import { sanitizeForClient } from '../../lib/visibility';
import { createProjectStructure } from '../../lib/basecamp/write';
import { previewProyecto, crearProyectoDesdePlantilla } from '../../lib/builder/service';
import type { EstadoOperativo } from '@backio/shared';

export const proyectos = new Hono();

const bloqueSchema = z.object({
  bloque_id: z.string().uuid(),
  activo: z.boolean(),
  owner_id: z.string().uuid().nullable(),
  piezas_por_canal: z.record(z.number().int().min(0)).default({}),
  piezas_por_tipo: z.record(z.number().int().min(0)).default({}),
  una_tarea_por_pieza: z.boolean().default(false),
});

const crearSchema = z.object({
  cliente_id: z.string().uuid(),
  plantilla_id: z.string().uuid(),
  nombre: z.string().min(3).max(120),
  brief: z.object({
    objetivo_negocio: z.string().min(1),
    publico_objetivo: z.string().min(1),
    canales: z.array(z.string()).min(1),
    mandatorios_marca: z.string().optional(),
    presupuesto_aprobado: z.number().nullable().optional(),
    archivos_referencia: z.array(z.string()).optional(),
  }),
  fecha_entrega: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fecha_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  prometio_cotizacion_id: z.string().uuid().nullable().optional(),
  bloques: z.array(bloqueSchema).default([]),
  owner_ejecutiva: z.string().uuid().nullable().optional(),
  repetir_mensual: z.boolean().optional(),
  periodo: z.string().regex(/^\d{4}-\d{2}$/).nullable().optional(),
});

/** Borradores creados por PrometIO (cotización aprobada) pendientes de convertir en proyecto. */
proyectos.get('/borradores', requireScope('read:proyectos'), async (c) => {
  const ctx = ctxOf(c);
  const { data, error } = await ctx.db
    .from('proyecto_borradores')
    .select('id, cliente_id, prometio_cotizacion_id, plantilla_sugerida_id, payload, estado, proyecto_id, created_at')
    .eq('tenant_id', ctx.tenantId)
    .eq('estado', 'pendiente')
    .order('created_at', { ascending: false });
  if (error) throw new DbError(error.message, 500);
  return c.json({ items: data ?? [] });
});

proyectos.post('/borradores/:id/descartar', requireScope('write:proyectos'), async (c) => {
  const ctx = ctxOf(c);
  const { error } = await ctx.db.from('proyecto_borradores').update({ estado: 'descartado' }).eq('tenant_id', ctx.tenantId).eq('id', c.req.param('id'));
  if (error) throw new DbError(error.message, 500);
  await audit(ctx, { accion: 'descartar_borrador', entidad: 'proyecto_borrador', entidad_id: c.req.param('id') });
  return c.body(null, 204);
});

proyectos.get('/', requireScope('read:proyectos'), async (c) => {
  const items = await listProyectos(ctxOf(c), {
    cliente_id: c.req.query('cliente') || undefined,
    estado: (c.req.query('estado') as EstadoOperativo) || undefined,
  });
  return c.json({ items, total: items.length });
});

proyectos.get('/:id', requireScope('read:proyectos'), async (c) => {
  const p = await getProyectoDetalle(ctxOf(c), c.req.param('id'));
  return p ? c.json(p) : c.json({ error: 'No encontrado' }, 404);
});

/** Preview del paso 5: mismo plan que se ejecutará, con vista interna y vista cliente (misma sanitizeForClient). */
proyectos.post('/preview', requireScope('read:proyectos'), zValidator('json', crearSchema), async (c) => {
  const p = await previewProyecto(ctxOf(c), c.req.valid('json'));
  return c.json({ plan: p.plan, vista_cliente: p.vista_cliente, alertas: p.alertas, resumen: p.resumen });
});

proyectos.post('/', requireScope('write:proyectos'), zValidator('json', crearSchema), async (c) => {
  const ctx = ctxOf(c);
  const input = c.req.valid('json');
  const r = await crearProyectoDesdePlantilla(ctx, input);
  let recurrencia: unknown = null;
  if (input.repetir_mensual) {
    const plantilla = await getPlantillaArbol(ctx, input.plantilla_id);
    const periodo = input.periodo ?? input.fecha_entrega.slice(0, 7);
    await updateProyecto(ctx, r.proyecto.id, { periodo });
    const rec = await upsertRecurrencia(ctx, {
      cliente_id: input.cliente_id, plantilla_id: input.plantilla_id, nombre_patron: plantilla?.patron_nombre ?? `${plantilla?.nombre ?? input.nombre} - {mes} {año}`,
      brief: input.brief, bloques: input.bloques, owner_ejecutiva: input.owner_ejecutiva ?? ctx.usuarioId, proyecto_origen_id: r.proyecto.id, ultimo_mes_generado: periodo, ultimo_proyecto_id: r.proyecto.id,
    });
    await updateProyecto(ctx, r.proyecto.id, { recurrencia_id: rec.id });
    recurrencia = rec;
  }
  return c.json({ ...r, recurrencia }, 201);
});

proyectos.post('/:id/basecamp/reintentar', requireScope('write:proyectos'), async (c) => {
  const ctx = ctxOf(c);
  const det = await getProyectoDetalle(ctx, c.req.param('id'));
  if (!det) return c.json({ error: 'No encontrado' }, 404);
  const confirmar = c.req.query('confirmar') === '1';
  try {
    const r = await createProjectStructure(ctx, det, det.requerimientos, { confirmarSobreLimite: confirmar });
    return c.json(r);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 422);
  }
});

const patchSchema = z.object({
  nombre: z.string().min(3).optional(),
  estado: z.enum(['backlog', 'priorizado', 'en_ejecucion', 'en_revision', 'reprogramado', 'bloqueado', 'completado', 'cancelado']).optional(),
  fecha_entrega: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  owner_ejecutiva: z.string().uuid().nullable().optional(),
  portal_activo: z.boolean().optional(),
  mesa_id: z.string().uuid().nullable().optional(),
});

proyectos.patch('/:id', requireScope('write:proyectos'), zValidator('json', patchSchema), async (c) => {
  const ctx = ctxOf(c);
  const p = await updateProyecto(ctx, c.req.param('id'), c.req.valid('json'));
  await audit(ctx, { accion: 'actualizar_proyecto', entidad: 'proyecto', entidad_id: p.id, detalle: c.req.valid('json') });
  return c.json(p);
});

proyectos.post('/:id/portal/rotar', requireScope('write:proyectos'), async (c) => {
  const ctx = ctxOf(c);
  const p = await updateProyecto(ctx, c.req.param('id'), { portal_token: generarPortalToken() });
  await audit(ctx, { accion: 'rotar_portal_token', entidad: 'proyecto', entidad_id: p.id });
  return c.json({ portal_token: p.portal_token });
});

/** Vista cliente de un proyecto para uso interno (exactamente lo que ve el cliente). */
proyectos.get('/:id/vista-cliente', requireScope('read:proyectos'), async (c) => {
  const det = await getProyectoDetalle(ctxOf(c), c.req.param('id'));
  if (!det) return c.json({ error: 'No encontrado' }, 404);
  return c.json(sanitizeForClient(det, det.requerimientos));
});

proyectos.delete('/:id', requireScope('write:proyectos'), async (c) => {
  const ctx = ctxOf(c);
  const p = await getProyecto(ctx, c.req.param('id'));
  if (!p) throw new DbError('No encontrado', 404);
  await updateProyecto(ctx, p.id, { deleted_at: new Date().toISOString() });
  await audit(ctx, { accion: 'eliminar_proyecto', entidad: 'proyecto', entidad_id: p.id });
  return c.body(null, 204);
});
