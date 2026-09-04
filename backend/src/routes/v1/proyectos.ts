import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import { listProyectos, getProyectoDetalle, getProyecto, updateProyecto, audit, DbError } from '../../lib/db';
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
  const r = await crearProyectoDesdePlantilla(ctxOf(c), c.req.valid('json'));
  return c.json(r, 201);
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
