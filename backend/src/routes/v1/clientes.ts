import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import { listClientes, getCliente, updateClienteConfig, listProyectos, listBacklog, audit } from '../../lib/db';
import type { ResumenClientePrometio } from '@backio/shared';
import { registrarWebhookCliente, diagnosticoWebhookCliente } from '../../lib/basecamp/webhooks';

export const clientes = new Hono();

clientes.get('/', requireScope('read:proyectos'), async (c) => {
  const items = await listClientes(ctxOf(c), { incluirInactivos: c.req.query('todos') === '1' });
  return c.json({ items, total: items.length });
});

clientes.get('/:id', requireScope('read:proyectos'), async (c) => {
  const cl = await getCliente(ctxOf(c), c.req.param('id'));
  return cl ? c.json(cl) : c.json({ error: 'No encontrado' }, 404);
});

/** Widget para la ficha de cliente en PrometIO (docs/08 · Flujo 2). */
clientes.get('/:id/resumen', requireScope('read:proyectos'), async (c) => {
  const ctx = ctxOf(c);
  const id = c.req.param('id');
  const cl = await getCliente(ctx, id);
  if (!cl) return c.json({ error: 'No encontrado' }, 404);
  const [proyectos, activos] = await Promise.all([
    listProyectos(ctx, { cliente_id: id }),
    listBacklog(ctx, { cliente_id: id, solo_activos: true }),
  ]);
  const enCurso = proyectos.filter((p) => !['completado', 'cancelado'].includes(p.estado));
  const out: ResumenClientePrometio = {
    cliente_id: id,
    proyectos_activos: enCurso.length,
    proyectos: enCurso.map((p) => ({ nombre: p.nombre, avance: p.avance, entrega: p.fecha_entrega, estado: p.estado })),
    requerimientos_atrasados: activos.filter((r) => r.dias_atraso > 0).length,
    dias_sin_movimiento: activos.length ? Math.min(...activos.map((r) => r.dias_sin_movimiento)) : 0,
    esperando_cliente: activos.filter((r) => r.estado_aprobacion === 'pendiente_cliente').length,
  };
  return c.json(out);
});

const patchSchema = z.object({
  basecamp_project_id: z.number().int().nullable().optional(),
  color_primario: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  logo_url: z.string().url().nullable().optional(),
  config: z.record(z.unknown()).optional(),
  mesa_id: z.string().uuid().nullable().optional(),
});

clientes.patch('/:id', requireScope('admin'), zValidator('json', patchSchema), async (c) => {
  const ctx = ctxOf(c);
  const cl = await updateClienteConfig(ctx, c.req.param('id'), c.req.valid('json'));
  await audit(ctx, { accion: 'actualizar_config', entidad: 'cliente', entidad_id: cl.id, detalle: c.req.valid('json') });
  return c.json(cl);
});

/** Registra el webhook de BackIO en el proyecto Basecamp del cliente (idempotente). */
clientes.post('/:id/basecamp/webhook', requireScope('admin'), async (c) => {
  try {
    return c.json(await registrarWebhookCliente(ctxOf(c), c.req.param('id')));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 422);
  }
});

clientes.get('/:id/basecamp/webhook', requireScope('admin'), async (c) => {
  try {
    return c.json(await diagnosticoWebhookCliente(ctxOf(c), c.req.param('id')));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 422);
  }
});
