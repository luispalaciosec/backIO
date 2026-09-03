import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import {
  listBacklog, getRequerimiento, insertRequerimientos, updateRequerimiento, softDeleteRequerimiento,
  audit, listClientes, listUsuarios, getClienteBySlug, insertProyecto, listProyectos, getUsuarioByEmail, DbError,
} from '../../lib/db';
import { parseCSV, validarFilas, esVisible } from '../../lib/builder/import';
import { pushDueDate } from '../../lib/basecamp/write';
import { generarPortalToken } from '../../lib/portal/token';
import type { EstadoOperativo, Prioridad } from '@backio/shared';

export const requerimientos = new Hono();

const ESTADOS = ['backlog', 'priorizado', 'en_ejecucion', 'en_revision', 'reprogramado', 'bloqueado', 'completado', 'cancelado'] as const;
const APROB = ['no_aplica', 'pendiente_interno', 'pendiente_cliente', 'aprobado', 'rechazado'] as const;
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

requerimientos.get('/', requireScope('read:backlog'), async (c) => {
  const q = c.req.query();
  const items = await listBacklog(ctxOf(c), {
    cliente_id: q.cliente || undefined,
    proyecto_id: q.proyecto || undefined,
    owner: q.owner || undefined,
    estado: (q.estado as EstadoOperativo) || undefined,
    solo_activos: q.activos === '1',
    min_dias_atraso: q.min_dias_atraso ? Number(q.min_dias_atraso) : undefined,
    desde: q.desde || undefined,
    hasta: q.hasta || undefined,
    query: q.q || undefined,
  });
  return c.json({ items, total: items.length });
});

requerimientos.get('/:id', requireScope('read:backlog'), async (c) => {
  const r = await getRequerimiento(ctxOf(c), c.req.param('id'));
  return r ? c.json(r) : c.json({ error: 'No encontrado' }, 404);
});

const crearSchema = z.object({
  cliente_id: z.string().uuid(),
  proyecto_id: z.string().uuid().nullable().optional(),
  titulo_interno: z.string().min(2),
  etiqueta_cliente: z.string().nullable().optional(),
  visible_cliente: z.boolean().default(false),
  bloque_nombre: z.string().nullable().optional(),
  tipo_trabajo: z.enum(['fee', 'proyecto']).default('fee'),
  prioridad: z.enum(['alta', 'media', 'baja']).default('media'),
  peso: z.number().min(0).default(1),
  fecha_pedido: fecha.nullable().optional(),
  fecha_entrega: fecha.nullable().optional(),
  owner_agencia: z.array(z.string().uuid()).default([]),
  piezas: z.number().int().min(0).default(0),
});

requerimientos.post('/', requireScope('write:requerimientos'), zValidator('json', crearSchema), async (c) => {
  const ctx = ctxOf(c);
  const [r] = await insertRequerimientos(ctx, [c.req.valid('json')]);
  if (!r) throw new DbError('No se pudo crear', 500);
  await audit(ctx, { accion: 'crear', entidad: 'requerimiento', entidad_id: r.id });
  return c.json(r, 201);
});

const patchSchema = z.object({
  titulo_interno: z.string().min(2).optional(),
  etiqueta_cliente: z.string().nullable().optional(),
  visible_cliente: z.literal(false).optional(), // solo restringir; abrir lo bloquea el trigger igualmente
  estado_operativo: z.enum(ESTADOS).optional(),
  estado_aprobacion: z.enum(APROB).optional(),
  prioridad: z.enum(['alta', 'media', 'baja']).optional(),
  peso: z.number().min(0).optional(),
  fecha_entrega: fecha.nullable().optional(),
  owner_agencia: z.array(z.string().uuid()).optional(),
  owner_cliente: z.array(z.string()).nullable().optional(),
  piezas: z.number().int().min(0).optional(),
  brief_url: z.string().url().nullable().optional(),
  entregable_urls: z.array(z.string().url()).nullable().optional(),
});

requerimientos.patch('/:id', requireScope('write:requerimientos'), zValidator('json', patchSchema), async (c) => {
  const ctx = ctxOf(c);
  const id = c.req.param('id');
  const previo = await getRequerimiento(ctx, id);
  if (!previo) return c.json({ error: 'No encontrado' }, 404);
  const patch = c.req.valid('json');

  // Basecamp manda sobre completed: no se completa desde BackIO si el to-do existe en Basecamp.
  if (patch.estado_operativo === 'completado' && previo.basecamp_todo_id) {
    return c.json({ error: 'Este requerimiento se completa desde Basecamp (fuente de verdad de completed).' }, 422);
  }

  const r = await updateRequerimiento(ctx, id, patch);
  const reprogramado = patch.fecha_entrega !== undefined && patch.fecha_entrega !== previo.fecha_entrega;
  await audit(ctx, {
    accion: reprogramado ? 'reprogramar' : 'actualizar',
    entidad: 'requerimiento',
    entidad_id: id,
    detalle: reprogramado ? { de: previo.fecha_entrega, a: patch.fecha_entrega, ...patch } : patch,
  });
  if (reprogramado && r.basecamp_todo_id) {
    pushDueDate(ctx, r).catch((err) => console.error('[basecamp] due_on no sincronizado', err));
  }
  return c.json(r);
});

requerimientos.delete('/:id', requireScope('write:requerimientos'), async (c) => {
  const ctx = ctxOf(c);
  await softDeleteRequerimiento(ctx, c.req.param('id'));
  await audit(ctx, { accion: 'eliminar', entidad: 'requerimiento', entidad_id: c.req.param('id') });
  return c.body(null, 204);
});

/** Bulk import · preview (no escribe). */
requerimientos.post('/bulk/preview', requireScope('write:requerimientos'), async (c) => {
  const ctx = ctxOf(c);
  const csv = await c.req.text();
  const [clientes, usuarios] = await Promise.all([listClientes(ctx), listUsuarios(ctx)]);
  const preview = validarFilas(parseCSV(csv), {
    clientesSlug: new Set(clientes.map((x) => x.slug)),
    usuariosEmail: new Set(usuarios.map((u) => u.email.toLowerCase())),
  });
  return c.json(preview);
});

/** Bulk import · confirmar. Transaccional: si alguna fila es inválida, no entra ninguna. */
requerimientos.post('/bulk', requireScope('write:requerimientos'), async (c) => {
  const ctx = ctxOf(c);
  const csv = await c.req.text();
  const [clientes, usuarios] = await Promise.all([listClientes(ctx), listUsuarios(ctx)]);
  const preview = validarFilas(parseCSV(csv), {
    clientesSlug: new Set(clientes.map((x) => x.slug)),
    usuariosEmail: new Set(usuarios.map((u) => u.email.toLowerCase())),
  });
  if (preview.rechazadas.length > 0) {
    return c.json({ error: 'Hay filas inválidas. Import es todo o nada.', preview }, 422);
  }

  const proyectosExistentes = await listProyectos(ctx);
  const proyectoPorClave = new Map<string, string>();
  const rows = [];
  for (const f of preview.validas) {
    const cliente = (await getClienteBySlug(ctx, f.cliente_slug))!;
    let proyectoId: string | null = null;
    if (f.proyecto) {
      const clave = `${cliente.id}:${f.proyecto}`;
      proyectoId = proyectoPorClave.get(clave) ?? proyectosExistentes.find((p) => p.cliente_id === cliente.id && p.nombre === f.proyecto)?.id ?? null;
      if (!proyectoId) {
        const hoy = new Date().toISOString().slice(0, 10);
        const p = await insertProyecto(ctx, {
          cliente_id: cliente.id, plantilla_id: null, nombre: f.proyecto, brief: {},
          fecha_inicio: hoy, fecha_entrega: f.fecha_entrega || hoy, portal_token: generarPortalToken(),
        });
        proyectoId = p.id;
      }
      proyectoPorClave.set(clave, proyectoId);
    }
    const owner = f.owner_email ? await getUsuarioByEmail(ctx, f.owner_email) : null;
    rows.push({
      cliente_id: cliente.id,
      proyecto_id: proyectoId,
      titulo_interno: f.titulo_interno,
      etiqueta_cliente: f.etiqueta_cliente || null,
      visible_cliente: esVisible(f.visible),
      bloque_nombre: f.bloque || null,
      tipo_trabajo: (f.tipo as 'fee' | 'proyecto') || 'fee',
      prioridad: (f.prioridad as Prioridad) || 'media',
      peso: f.peso ? Number(f.peso) : 1,
      fecha_pedido: f.fecha_pedido || null,
      fecha_entrega: f.fecha_entrega || null,
      owner_agencia: owner ? [owner.id] : [],
      piezas: f.piezas ? Number(f.piezas) : 0,
    });
  }
  const creados = await insertRequerimientos(ctx, rows);
  await audit(ctx, { accion: 'bulk_import', entidad: 'requerimiento', detalle: { filas: creados.length } });
  return c.json({ creados: creados.length, items: creados }, 201);
});
