import { Hono, type Context } from 'hono';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import { listClientes, getCliente, updateClienteConfig, listProyectos, listBacklog, audit } from '../../lib/db';
import type { ResumenClientePrometio } from '@backio/shared';
import { registrarWebhookCliente, diagnosticoWebhookCliente, actualizarWebhooksTenant } from '../../lib/basecamp/webhooks';
import { importarBasecampCliente } from '../../lib/basecamp/importar';
import { guardarPin, clientesConPin, migrarPinesEnClaro } from '../../lib/portal/pin';

export const clientes = new Hono();

/** `config` guarda el PIN del portal e ids de webhook: solo la ve admin (o una API key con scope admin). */
function esAdmin(c: Context): boolean {
  const a = c.get('auth');
  return a.tipo === 'usuario' ? a.rol === 'admin' : a.scopes.includes('admin');
}
function sinConfig<T extends { config?: unknown }>(c: Context, x: T): T {
  return esAdmin(c) ? x : { ...x, config: {} };
}

clientes.get('/', requireScope('read:proyectos'), async (c) => {
  const ctx = ctxOf(c);
  const items = (await listClientes(ctx, { incluirInactivos: c.req.query('todos') === '1' })).map((x) => sinConfig(c, x));
  // Admin ve si cada cliente tiene PIN (nunca el PIN: se guarda con hash).
  if (!esAdmin(c)) return c.json({ items, total: items.length });
  const conPin = await clientesConPin(ctx.tenantId);
  return c.json({ items: items.map((x) => ({ ...x, portal_pin_configurado: conPin.has(x.id) })), total: items.length });
});

clientes.get('/:id', requireScope('read:proyectos'), async (c) => {
  const cl = await getCliente(ctxOf(c), c.req.param('id'));
  return cl ? c.json(sinConfig(c, cl)) : c.json({ error: 'No encontrado' }, 404);
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
  color_primario: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  logo_url: z.string().url().nullable().optional(),
  config: z.record(z.unknown()).optional(),
  mesa_id: z.string().uuid().nullable().optional(),
  activo: z.boolean().optional(),
  /** PIN del portal: 4 a 6 dígitos para fijarlo, null para quitarlo; ausente = sin cambios. Se guarda con hash. */
  portal_pin: z
    .string()
    .regex(/^\d{4,6}$/, 'El PIN debe tener de 4 a 6 dígitos')
    .nullable()
    .optional(),
});

/**
 * Alta manual de cliente (admin). Para cuentas que no pasan por PrometIO o que están divididas en ramas
 * (p. ej. AB-Inbev con un proyecto Basecamp por rama). El id se genera aquí; si luego PrometIO manda la
 * empresa, se enlaza por nombre desde Admin.
 */
clientes.post(
  '/',
  requireScope('admin'),
  zValidator(
    'json',
    z.object({
      nombre: z.string().min(2).max(120),
      basecamp_project_id: z.number().int().nullable().optional(),
      mesa_id: z.string().uuid().nullable().optional(),
      color_primario: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .nullable()
        .optional(),
      grupo: z.string().max(80).nullable().optional(),
    }),
  ),
  async (c) => {
    const ctx = ctxOf(c);
    const b = c.req.valid('json');
    const slug =
      b.nombre
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60) || `cliente-${Date.now()}`;
    const { data: dup } = await ctx.db
      .from('clientes')
      .select('id, nombre')
      .eq('tenant_id', ctx.tenantId)
      .or(`slug.eq.${slug}${b.basecamp_project_id ? `,basecamp_project_id.eq.${b.basecamp_project_id}` : ''}`)
      .maybeSingle();
    if (dup)
      return c.json(
        { error: `Ya existe un cliente con ese nombre o ese proyecto de Basecamp: ${(dup as { nombre: string }).nombre}` },
        409,
      );
    const { data, error } = await ctx.db
      .from('clientes')
      .insert({
        id: randomUUID(),
        tenant_id: ctx.tenantId,
        nombre: b.nombre,
        slug,
        basecamp_project_id: b.basecamp_project_id ?? null,
        mesa_id: b.mesa_id ?? null,
        color_primario: b.color_primario ?? '#0073EA',
        activo: true,
        config: { origen: 'manual', ...(b.grupo ? { grupo: b.grupo } : {}) },
      })
      .select()
      .single();
    if (error) return c.json({ error: error.message }, 500);
    await audit(ctx, {
      accion: 'crear_cliente',
      entidad: 'cliente',
      entidad_id: (data as { id: string }).id,
      detalle: { nombre: b.nombre, basecamp_project_id: b.basecamp_project_id ?? null, origen: 'manual' },
    });
    return c.json(data, 201);
  },
);

clientes.patch('/:id', requireScope('admin'), zValidator('json', patchSchema), async (c) => {
  const ctx = ctxOf(c);
  const { portal_pin, ...patch } = c.req.valid('json');
  // El PIN nunca vuelve a config (en claro): va con hash a portal_pines (auditoría 10/10, M3).
  if (patch.config && 'portal_pin' in patch.config) {
    const { portal_pin: _p, ...resto } = patch.config;
    patch.config = resto;
  }
  if (!(await getCliente(ctx, c.req.param('id')))) return c.json({ error: 'No encontrado' }, 404);
  const cl = Object.keys(patch).length
    ? await updateClienteConfig(ctx, c.req.param('id'), patch)
    : (await getCliente(ctx, c.req.param('id')))!;
  if (portal_pin !== undefined) await guardarPin(ctx.tenantId, cl.id, portal_pin);
  await audit(ctx, {
    accion: 'actualizar_config',
    entidad: 'cliente',
    entidad_id: cl.id,
    detalle: { ...patch, ...(portal_pin !== undefined ? { portal_pin: portal_pin ? 'cambiado' : 'quitado' } : {}) },
  });
  return c.json(cl);
});

/** Una sola vez: pasa los PIN que sigan en claro en clientes.config a hash en portal_pines. Idempotente. */
clientes.post('/portal-pines/migrar', requireScope('admin'), async (c) => {
  const ctx = ctxOf(c);
  const migrados = await migrarPinesEnClaro(ctx.tenantId);
  await audit(ctx, { accion: 'migrar_pines_portal', entidad: 'cliente', detalle: { migrados } });
  return c.json({ migrados });
});

/** Rotación del secreto del webhook: reescribe la URL en todos los clientes activos. Solo admin. */
clientes.post('/basecamp/webhooks/actualizar', requireScope('admin'), async (c) => {
  try {
    return c.json(await actualizarWebhooksTenant(ctxOf(c)));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 422);
  }
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
/** Sincronizar con Basecamp: admin, operaciones y ejecutivas (decidido por Luis 17/09/2026). */
clientes.post('/:id/basecamp/importar', requireScope('write:proyectos'), async (c) => {
  const a = c.get('auth');
  if (a.tipo === 'usuario' && !['admin', 'operaciones', 'ejecutiva'].includes(a.rol ?? ''))
    return c.json({ error: 'Solo admin, operaciones y ejecutivas pueden sincronizar con Basecamp' }, 403);
  try {
    const dias = Number(c.req.query('dias_completados') ?? 60);
    return c.json(await importarBasecampCliente(ctxOf(c), c.req.param('id'), { diasCompletados: Number.isFinite(dias) ? dias : 60 }));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 422);
  }
});
