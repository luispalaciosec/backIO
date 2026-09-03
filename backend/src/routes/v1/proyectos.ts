import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import {
  listProyectos, getProyectoDetalle, getProyecto, insertProyecto, updateProyecto,
  getPlantillaArbol, insertRequerimientos, audit, getCliente, listUsuarios, DbError,
} from '../../lib/db';
import { planificarProyecto } from '../../lib/builder/plan';
import { generarPortalToken } from '../../lib/portal/token';
import { sanitizeForClient } from '../../lib/visibility';
import { createProjectStructure } from '../../lib/basecamp/write';
import { restarDias } from '../../lib/builder/plan';
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
  const ctx = ctxOf(c);
  const input = c.req.valid('json');
  const plantilla = await getPlantillaArbol(ctx, input.plantilla_id);
  if (!plantilla) return c.json({ error: 'Plantilla no encontrada' }, 404);
  const plan = planificarProyecto({ plantilla, fecha_entrega: input.fecha_entrega, bloques: input.bloques });
  const usuarios = await listUsuarios(ctx);
  const ahora = new Date().toISOString();
  const vistaCliente = sanitizeForClient(
    { nombre: input.nombre, fecha_entrega: input.fecha_entrega },
    plan.tareas.map((t, i) => ({
      id: `preview-${i}`,
      etiqueta_cliente: t.etiqueta_cliente,
      visible_cliente: t.visible_cliente,
      peso: t.peso,
      estado_operativo: 'backlog',
      estado_aprobacion: 'no_aplica',
      fecha_entrega: t.fecha_entrega,
      ultima_actualizacion: ahora,
    })),
  );
  return c.json({
    plan,
    vista_cliente: vistaCliente,
    alertas: plan.alertas.map((a) => ({ ...a, nombre: usuarios.find((u) => u.id === a.owner_id)?.nombre ?? a.owner_id })),
  });
});

proyectos.post('/', requireScope('write:proyectos'), zValidator('json', crearSchema), async (c) => {
  const ctx = ctxOf(c);
  const input = c.req.valid('json');
  const [plantilla, cliente] = await Promise.all([getPlantillaArbol(ctx, input.plantilla_id), getCliente(ctx, input.cliente_id)]);
  if (!plantilla) return c.json({ error: 'Plantilla no encontrada' }, 404);
  if (!cliente) return c.json({ error: 'Cliente no encontrado' }, 404);

  const plan = planificarProyecto({ plantilla, fecha_entrega: input.fecha_entrega, bloques: input.bloques });
  const primeraFecha = plan.tareas.map((t) => t.fecha_entrega).sort()[0] ?? input.fecha_entrega;
  const fecha_inicio = input.fecha_inicio ?? (primeraFecha < input.fecha_entrega ? primeraFecha : restarDias(input.fecha_entrega, 1));

  const proyecto = await insertProyecto(ctx, {
    cliente_id: input.cliente_id,
    plantilla_id: input.plantilla_id,
    prometio_cotizacion_id: input.prometio_cotizacion_id ?? null,
    nombre: input.nombre,
    brief: { actual: { ...input.brief, version: 1, creado_at: new Date().toISOString() }, historial: [] },
    fecha_inicio,
    fecha_entrega: input.fecha_entrega,
    owner_ejecutiva: input.owner_ejecutiva ?? ctx.usuarioId,
    portal_token: generarPortalToken(),
  });

  const reqs = await insertRequerimientos(
    ctx,
    plan.tareas.map((t) => ({
      cliente_id: input.cliente_id,
      proyecto_id: proyecto.id,
      bloque_nombre: t.bloque_nombre,
      plantilla_tarea_id: t.plantilla_tarea_id,
      titulo_interno: t.titulo_interno,
      etiqueta_cliente: t.etiqueta_cliente,
      visible_cliente: t.visible_cliente,
      tipo_trabajo: 'proyecto',
      estado_operativo: 'priorizado',
      peso: t.peso,
      fecha_pedido: fecha_inicio,
      fecha_entrega: t.fecha_entrega,
      owner_agencia: t.owner_agencia,
      piezas: t.piezas,
    })),
  );

  await audit(ctx, {
    accion: 'crear_proyecto', entidad: 'proyecto', entidad_id: proyecto.id,
    detalle: { requerimientos: reqs.length, visibles: plan.visibles, alertas: plan.alertas },
  });

  // Basecamp: se intenta si el cliente tiene proyecto configurado; si falla, queda sync_estado=incompleto y se reintenta.
  let basecamp: unknown = { omitido: true, motivo: 'cliente sin basecamp_project_id' };
  if (cliente.basecamp_project_id) {
    try {
      basecamp = await createProjectStructure(ctx, proyecto, reqs);
    } catch (err) {
      await updateProyecto(ctx, proyecto.id, { sync_estado: 'incompleto' });
      basecamp = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  return c.json({ proyecto, requerimientos: reqs, alertas: plan.alertas, basecamp }, 201);
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
