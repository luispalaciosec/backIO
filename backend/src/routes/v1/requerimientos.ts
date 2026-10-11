import { alcanceMesa } from '../../lib/db/mesas';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { zValidator } from '../../lib/validacion';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import { esColaborador, esColaboradorHumano } from '../../lib/auth/roles';
import { unaLinea } from '../../lib/validacion';
import {
  listBacklog,
  getRequerimiento,
  insertRequerimientos,
  softDeleteRequerimiento,
  audit,
  listClientes,
  listUsuarios,
  getClienteBySlug,
  insertProyecto,
  listProyectos,
  getUsuarioByEmail,
  DbError,
} from '../../lib/db';
import { parseCSV, validarFilas, esVisible } from '../../lib/builder/import';
import { pushRequerimiento } from '../../lib/basecamp/write';
import { getProyecto } from '../../lib/db';
import { generarPortalToken } from '../../lib/portal/token';
import type { EstadoOperativo, Prioridad, MotivoReprogramacion, MotivoReproceso, OrigenReproceso } from '@backio/shared';
import { MOTIVOS_REPROCESO, MOTIVOS_REPROGRAMACION, finDiaLocal, hoyLocal, inicioDiaLocal } from '@backio/shared';
import { listReprogramaciones, listReprocesos, setMotivoReprogramacion, listSinMotivo, updateReproceso } from '../../lib/db/historial';
import { listBitacora, insertBitacora, deleteBitacora, ultimaBitacoraPorRequerimiento } from '../../lib/db/bitacora';
import { registrarReproceso, cerrarReproceso } from '../../lib/cumplimiento';
import { actualizarRequerimiento, ReglaError } from '../../lib/requerimientos/actualizar';
import { ensureSemana } from '../../lib/db/semanas';

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
    mesa: q.mesa ? await alcanceMesa(ctxOf(c), q.mesa) : undefined,
  });
  return c.json({ items, total: items.length });
});

// Antes de '/:id': si no, Hono intenta tratar 'causas-pendientes' como uuid.
requerimientos.get('/causas-pendientes', requireScope('read:backlog'), async (c) => c.json(await listSinMotivo(ctxOf(c), 45)));

// ---------------- Bitácora (observaciones fechadas por tarea): lecturas antes de '/:id'
/** Última nota por requerimiento (columna Observación del backlog). */
requerimientos.get('/bitacora/ultimas', requireScope('read:backlog'), async (c) =>
  c.json({ items: await ultimaBitacoraPorRequerimiento(ctxOf(c), { dias: Number(c.req.query('dias') ?? 120) || 120 }) }),
);
/**
 * Estatus por cliente para la reunión semanal: tareas activas (o completadas dentro del rango) con su última
 * observación hasta `hasta`. Reemplaza la hoja "Control de tareas".
 */
requerimientos.get('/estatus', requireScope('read:backlog'), async (c) => {
  const ctx = ctxOf(c);
  const q = c.req.query();
  if (!q.cliente) return c.json({ error: 'cliente requerido' }, 400);
  const hastaIso = q.hasta ? finDiaLocal(q.hasta) : new Date().toISOString();
  const desdeIso = q.desde ? inicioDiaLocal(q.desde) : null;
  const todas = await listBacklog(ctx, { cliente_id: q.cliente });
  const items = todas.filter(
    (r) =>
      !['completado', 'cancelado'].includes(r.estado_operativo) ||
      (r.estado_operativo === 'completado' && r.completado_at && (!desdeIso || r.completado_at >= desdeIso) && r.completado_at <= hastaIso),
  );
  const notas = await ultimaBitacoraPorRequerimiento(ctx, { ids: items.map((r) => r.id), hasta: hastaIso });
  return c.json({ items: items.map((r) => ({ ...r, ultima_nota: notas[r.id] ?? null })) });
});

requerimientos.get('/:id', requireScope('read:backlog'), async (c) => {
  const r = await getRequerimiento(ctxOf(c), c.req.param('id'));
  return r ? c.json(r) : c.json({ error: 'No encontrado' }, 404);
});

export const crearRequerimientoSchema = z.object({
  cliente_id: z.string().uuid(),
  proyecto_id: z.string().uuid().nullable().optional(),
  titulo_interno: unaLinea(2, 300),
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
  planificacion: z.enum(['planificado', 'no_planificado', 'urgente']).optional(),
  // Migración 22: sin default para no romper el alta antes de aplicarla (solo viajan si se envían).
  clase: z.enum(['tarea', 'propuesta', 'incidencia']).optional(),
  proactiva: z.boolean().optional(),
});

/** Marca 'no_planificado' si la semana ya tiene plan y la tarea vence dentro de esa semana. */
async function planificacionAutomatica(
  ctx: ReturnType<typeof ctxOf>,
  fechaEntrega: string | null | undefined,
): Promise<'planificado' | 'no_planificado'> {
  if (!fechaEntrega) return 'planificado';
  const semana = await ensureSemana(ctx, hoyLocal());
  const { count } = await ctx.db
    .from('actas')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', ctx.tenantId)
    .eq('semana_id', semana.id)
    .eq('tipo', 'plan_operativo');
  const hayPlan = !!semana.plan_publicado_at || (count ?? 0) > 0;
  return hayPlan && fechaEntrega <= semana.fecha_fin ? 'no_planificado' : 'planificado';
}

requerimientos.post('/', requireScope('write:requerimientos'), zValidator('json', crearRequerimientoSchema), async (c) => {
  const ctx = ctxOf(c);
  const body = c.req.valid('json');
  const planificacion = body.planificacion ?? (await planificacionAutomatica(ctx, body.fecha_entrega));
  const [r] = await insertRequerimientos(ctx, [{ ...body, planificacion }]);
  if (!r) throw new DbError('No se pudo crear', 500);
  await audit(ctx, { accion: 'crear', entidad: 'requerimiento', entidad_id: r.id });
  // Si pertenece a un proyecto ya sincronizado y tiene fecha, baja a Basecamp (regla: cliente → BackIO → Basecamp).
  let basecamp: unknown = null;
  if (r.proyecto_id && r.fecha_entrega) {
    const p = await getProyecto(ctx, r.proyecto_id);
    if (p?.basecamp_todolist_id) {
      try {
        basecamp = await pushRequerimiento(ctx, p, r);
      } catch (err) {
        basecamp = { error: err instanceof Error ? err.message : String(err) };
      }
    }
  }
  return c.json({ ...r, basecamp }, 201);
});

export const actualizarRequerimientoSchema = z.object({
  titulo_interno: unaLinea(2, 300).optional(),
  etiqueta_cliente: z.string().nullable().optional(),
  visible_cliente: z.literal(false).optional(), // solo restringir; abrir lo bloquea el trigger igualmente
  estado_operativo: z.enum(ESTADOS).optional(),
  estado_aprobacion: z.enum(APROB).optional(),
  prioridad: z.enum(['alta', 'media', 'baja']).optional(),
  peso: z.number().min(0).optional(),
  fecha_entrega: fecha.nullable().optional(),
  fecha_pedido: fecha.nullable().optional(),
  owner_agencia: z.array(z.string().uuid()).optional(),
  owner_cliente: z.array(z.string()).nullable().optional(),
  piezas: z.number().int().min(0).optional(),
  brief_url: z.string().url().nullable().optional(),
  entregable_urls: z.array(z.string().url()).nullable().optional(),
  motivo_reprogramacion: z
    .enum(MOTIVOS_REPROGRAMACION.map((m) => m.valor) as [MotivoReprogramacion, ...MotivoReprogramacion[]])
    .nullable()
    .optional(),
  observacion_reprogramacion: z.string().max(1000).nullable().optional(),
  planificacion: z.enum(['planificado', 'no_planificado', 'urgente']).optional(),
  daily_fecha: fecha.nullable().optional(),
  clase: z.enum(['tarea', 'propuesta', 'incidencia']).optional(),
  proactiva: z.boolean().optional(),
});

const escrituraOPropia: MiddlewareHandler = async (c, next) => {
  const a = c.get('auth');
  if (esColaboradorHumano(a)) return next(); // se valida en el handler
  return requireScope('write:requerimientos')(c, next);
};

requerimientos.patch('/:id', escrituraOPropia, zValidator('json', actualizarRequerimientoSchema), async (c) => {
  const ctx = ctxOf(c);
  try {
    const { requerimiento, basecamp_due_on } = await actualizarRequerimiento(ctx, c.req.param('id'), c.req.valid('json'), {
      colaborador: esColaborador(c.get('auth')),
      // Motivo obligatorio desde la UI (decidido 04/09). La API puede omitirlo: queda «sin causa» y sale como señal.
      exigirMotivo: ctx.origen === 'ui',
    });
    return c.json({ ...requerimiento, basecamp_due_on });
  } catch (e) {
    if (e instanceof ReglaError) return c.json({ error: e.message }, e.status);
    throw e;
  }
});

// ---------------- Cumplimiento: historial, reprocesos y causas pendientes

/**
 * Un colaborador solo toca lo suyo: devuelve una respuesta 403 si el requerimiento no es de la persona,
 * o null si puede seguir (roles de gestión, API keys y OAuth ya pasaron por requireScope).
 */
async function soloSiEsSuya(c: Context, requerimientoId: string | null): Promise<Response | null> {
  const a = c.get('auth');
  if (!esColaboradorHumano(a)) return null;
  const ctx = ctxOf(c);
  const r = requerimientoId ? await getRequerimiento(ctx, requerimientoId) : null;
  if (!r || !ctx.usuarioId || !r.owner_agencia.includes(ctx.usuarioId))
    return c.json({ error: 'Solo puedes actualizar las tareas asignadas a ti.' }, 403);
  return null;
}

requerimientos.patch(
  '/reprogramaciones/:rid',
  escrituraOPropia,
  zValidator(
    'json',
    z.object({
      motivo: z.enum(MOTIVOS_REPROGRAMACION.map((m) => m.valor) as [string, ...string[]]),
      observacion: z.string().max(1000).nullable().optional(),
    }),
  ),
  async (c) => {
    const ctx = ctxOf(c);
    const { data: rp } = await ctx.db
      .from('reprogramaciones')
      .select('requerimiento_id')
      .eq('tenant_id', ctx.tenantId)
      .eq('id', c.req.param('rid'))
      .maybeSingle();
    const bloqueo = await soloSiEsSuya(c, (rp as { requerimiento_id: string } | null)?.requerimiento_id ?? null);
    if (bloqueo) return bloqueo;
    await setMotivoReprogramacion(
      ctx,
      c.req.param('rid'),
      c.req.valid('json').motivo as MotivoReprogramacion,
      c.req.valid('json').observacion ?? null,
    );
    return c.body(null, 204);
  },
);

requerimientos.get('/:id/bitacora', requireScope('read:backlog'), async (c) =>
  c.json({ items: await listBitacora(ctxOf(c), c.req.param('id')) }),
);
requerimientos.post(
  '/:id/bitacora',
  escrituraOPropia,
  zValidator('json', z.object({ nota: z.string().trim().min(1).max(2000), visible_cliente: z.boolean().default(false) })),
  async (c) => {
    const ctx = ctxOf(c);
    const id = c.req.param('id');
    const b = c.req.valid('json');
    const r = await getRequerimiento(ctx, id);
    if (!r) return c.json({ error: 'No encontrado' }, 404);
    const bloqueo = await soloSiEsSuya(c, id);
    if (bloqueo) return bloqueo;
    const a = c.get('auth');
    // Lo que ve el cliente lo decide gestión: un colaborador anota, pero no publica al cliente.
    const visible = b.visible_cliente && r.visible_cliente && !esColaborador(a);
    const nota = await insertBitacora(ctx, {
      requerimiento_id: id,
      nota: b.nota,
      visible_cliente: visible,
      estado_operativo: r.estado_operativo,
      estado_aprobacion: r.estado_aprobacion,
    });
    await audit(ctx, {
      accion: 'bitacora',
      entidad: 'requerimiento',
      entidad_id: id,
      detalle: { nota: b.nota.slice(0, 200), visible_cliente: b.visible_cliente },
    });
    return c.json(nota, 201);
  },
);
requerimientos.delete('/:id/bitacora/:bid', escrituraOPropia, async (c) => {
  const ctx = ctxOf(c);
  const a = c.get('auth');
  if (esColaborador(a)) {
    // Un colaborador solo borra sus propias notas.
    const { data: nota } = await ctx.db
      .from('bitacora')
      .select('usuario_id, requerimiento_id')
      .eq('tenant_id', ctx.tenantId)
      .eq('id', c.req.param('bid'))
      .maybeSingle();
    const n = nota as { usuario_id: string | null; requerimiento_id: string } | null;
    if (!n || n.requerimiento_id !== c.req.param('id') || n.usuario_id !== ctx.usuarioId)
      return c.json({ error: 'Solo puedes borrar tus propias notas.' }, 403);
  }
  await deleteBitacora(ctx, c.req.param('bid'));
  await audit(ctx, {
    accion: 'bitacora_eliminar',
    entidad: 'requerimiento',
    entidad_id: c.req.param('id'),
    detalle: { bitacora_id: c.req.param('bid') },
  });
  return c.body(null, 204);
});

requerimientos.get('/:id/historial', requireScope('read:backlog'), async (c) => {
  const ctx = ctxOf(c);
  const id = c.req.param('id');
  const [reprogramaciones, reprocesos] = await Promise.all([listReprogramaciones(ctx, id), listReprocesos(ctx, id)]);
  return c.json({ reprogramaciones, reprocesos });
});

requerimientos.post(
  '/:id/reprocesos',
  escrituraOPropia,
  zValidator(
    'json',
    z.object({
      origen: z.enum(['cliente', 'interno']),
      motivo: z.enum(MOTIVOS_REPROCESO.map((m) => m.valor) as [string, ...string[]]),
      paso_retorno: z.string().max(60).nullable().optional(),
      observacion: z.string().max(1000).nullable().optional(),
      reabrir_basecamp: z.boolean().default(true),
      area_responsable: z.enum(['cuentas', 'produccion', 'diseno', 'creatividad', 'content']).nullable().optional(),
      atribuible: z.enum(['equipo', 'cliente', 'externo']).nullable().optional(),
    }),
  ),
  async (c) => {
    const ctx = ctxOf(c);
    const b = c.req.valid('json');
    const previo = await getRequerimiento(ctx, c.req.param('id'));
    if (!previo) return c.json({ error: 'No encontrado' }, 404);
    const a = c.get('auth');
    if (esColaborador(a) && !(ctx.usuarioId && previo.owner_agencia.includes(ctx.usuarioId)))
      return c.json({ error: 'Solo puedes registrar reprocesos en tus tareas' }, 403);
    const rp = await registrarReproceso(ctx, previo.id, {
      origen: b.origen as OrigenReproceso,
      motivo: b.motivo as MotivoReproceso,
      paso_retorno: b.paso_retorno ?? null,
      observacion: b.observacion ?? null,
      reabrir_basecamp: b.reabrir_basecamp,
      area_responsable: b.area_responsable ?? null,
      atribuible: b.atribuible ?? null,
    });
    return c.json(rp, 201);
  },
);

requerimientos.patch(
  '/:id/reprocesos/:rid',
  escrituraOPropia,
  zValidator(
    'json',
    z.object({
      motivo: z.enum(MOTIVOS_REPROCESO.map((m) => m.valor) as [string, ...string[]]).optional(),
      paso_retorno: z.string().max(60).nullable().optional(),
      observacion: z.string().max(1000).nullable().optional(),
      area_responsable: z.enum(['cuentas', 'produccion', 'diseno', 'creatividad', 'content']).nullable().optional(),
      atribuible: z.enum(['equipo', 'cliente', 'externo']).nullable().optional(),
    }),
  ),
  async (c) => {
    const ctx = ctxOf(c);
    const bloqueo = await soloSiEsSuya(c, c.req.param('id'));
    if (bloqueo) return bloqueo;
    const { data: rp } = await ctx.db
      .from('reprocesos')
      .select('requerimiento_id')
      .eq('tenant_id', ctx.tenantId)
      .eq('id', c.req.param('rid'))
      .maybeSingle();
    if ((rp as { requerimiento_id: string } | null)?.requerimiento_id !== c.req.param('id'))
      return c.json({ error: 'Reproceso no encontrado' }, 404);
    await updateReproceso(ctx, c.req.param('rid'), c.req.valid('json') as Parameters<typeof updateReproceso>[2]);
    return c.body(null, 204);
  },
);

requerimientos.post('/:id/reprocesos/:rid/cerrar', escrituraOPropia, async (c) => {
  const ctx = ctxOf(c);
  const bloqueo = await soloSiEsSuya(c, c.req.param('id'));
  if (bloqueo) return bloqueo;
  const rp = await cerrarReproceso(ctx, c.req.param('id'), c.req.param('rid'));
  return rp ? c.json(rp) : c.json({ error: 'Reproceso no encontrado' }, 404);
});

/**
 * «Respondido»: primera respuesta efectiva al cliente (KPI-CUE-03). Se fija una sola vez; nunca se lee de
 * comentarios de Basecamp (regla 1). `deshacer` la borra por si se marcó por error.
 */
requerimientos.post(
  '/:id/respondido',
  requireScope('write:requerimientos'),
  zValidator('json', z.object({ deshacer: z.boolean().default(false) })),
  async (c) => {
    const ctx = ctxOf(c);
    const id = c.req.param('id');
    const r = await getRequerimiento(ctx, id);
    if (!r) return c.json({ error: 'No encontrado' }, 404);
    const deshacer = c.req.valid('json').deshacer;
    if (!deshacer && r.primera_respuesta_at) return c.json({ primera_respuesta_at: r.primera_respuesta_at, ya_estaba: true });
    const valor = deshacer ? null : new Date().toISOString();
    const { error } = await ctx.db
      .from('requerimientos')
      .update({ primera_respuesta_at: valor })
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id);
    if (error)
      return c.json({ error: /primera_respuesta_at/.test(error.message) ? 'Falta aplicar la migración 22 (KPIs).' : error.message }, 422);
    await audit(ctx, {
      accion: deshacer ? 'respondido_deshacer' : 'respondido',
      entidad: 'requerimiento',
      entidad_id: id,
      detalle: { primera_respuesta_at: valor },
    });
    return c.json({ primera_respuesta_at: valor });
  },
);

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
      proyectoId =
        proyectoPorClave.get(clave) ?? proyectosExistentes.find((p) => p.cliente_id === cliente.id && p.nombre === f.proyecto)?.id ?? null;
      if (!proyectoId) {
        const hoy = hoyLocal();
        const p = await insertProyecto(ctx, {
          cliente_id: cliente.id,
          plantilla_id: null,
          nombre: f.proyecto,
          brief: {},
          fecha_inicio: hoy,
          fecha_entrega: f.fecha_entrega || hoy,
          portal_token: generarPortalToken(),
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
