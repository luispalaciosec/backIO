import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import { listClientes, getCliente, updateClienteConfig, listProyectos, listBacklog, audit } from '../../lib/db';
import type { ResumenClientePrometio } from '@backio/shared';
import { registrarWebhookCliente, diagnosticoWebhookCliente } from '../../lib/basecamp/webhooks';
import { importarBasecampCliente } from '../../lib/basecamp/importar';

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
  activo: z.boolean().optional(),
});

/**
 * Alta manual de cliente (admin). Para cuentas que no pasan por PrometIO o que están divididas en ramas
 * (p. ej. AB-Inbev con un proyecto Basecamp por rama). El id se genera aquí; si luego PrometIO manda la
 * empresa, se enlaza por nombre desde Admin.
 */
clientes.post('/', requireScope('admin'), zValidator('json', z.object({
  nombre: z.string().min(2).max(120),
  basecamp_project_id: z.number().int().nullable().optional(),
  mesa_id: z.string().uuid().nullable().optional(),
  color_primario: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  grupo: z.string().max(80).nullable().optional(),
})), async (c) => {
  const ctx = ctxOf(c);
  const b = c.req.valid('json');
  const slug = b.nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || `cliente-${Date.now()}`;
  const { data: dup } = await ctx.db.from('clientes').select('id, nombre').eq('tenant_id', ctx.tenantId).or(`slug.eq.${slug}${b.basecamp_project_id ? `,basecamp_project_id.eq.${b.basecamp_project_id}` : ''}`).maybeSingle();
  if (dup) return c.json({ error: `Ya existe un cliente con ese nombre o ese proyecto de Basecamp: ${(dup as { nombre: string }).nombre}` }, 409);
  const { data, error } = await ctx.db.from('clientes').insert({
    id: randomUUID(), tenant_id: ctx.tenantId, nombre: b.nombre, slug, basecamp_project_id: b.basecamp_project_id ?? null, mesa_id: b.mesa_id ?? null,
    color_primario: b.color_primario ?? '#0073EA', activo: true, config: { origen: 'manual', ...(b.grupo ? { grupo: b.grupo } : {}) },
  }).select().single();
  if (error) return c.json({ error: error.message }, 500);
  await audit(ctx, { accion: 'crear_cliente', entidad: 'cliente', entidad_id: (data as { id: string }).id, detalle: { nombre: b.nombre, basecamp_project_id: b.basecamp_project_id ?? null, origen: 'manual' } });
  return c.json(data, 201);
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

/** Importa las listas de to-dos existentes en el proyecto Basecamp del cliente (excepción D1: solo títulos). */
clientes.post('/:id/basecamp/importar', requireScope('admin'), async (c) => {
  try {
    const dias = Number(c.req.query('dias_completados') ?? 60);
    return c.json(await importarBasecampCliente(ctxOf(c), c.req.param('id'), { diasCompletados: Number.isFinite(dias) ? dias : 60 }));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 422);
  }
});
