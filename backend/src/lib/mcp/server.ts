/**
 * MCP Server de BackIO (docs/07). Una capa para Claude, ChatGPT, Gemini y agentes futuros.
 *
 * Regla crítica: ninguna tool devuelve texto de Basecamp (estructuralmente imposible: nunca entra
 * a la base). Con scope cliente, get_project_status devuelve sanitizeForClient.
 * Escrituras: preview + confirm, plan_id de 15 min y un solo uso. Todo auditado.
 *
 * ZONA DE REVISIÓN HUMANA: las tools de escritura (plan_* / confirm_plan / publish_document).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthInfo, Scope } from '../auth/middleware';
import type { DbCtx } from '../db/client';
import { DbError } from '../db/client';
import { listBacklog } from '../db/requerimientos';
import { getProyectoDetalle, listProyectos } from '../db/proyectos';
import { listClientes, getCliente } from '../db/clientes';
import { listPlantillas, getPlantillaArbol } from '../db/plantillas';
import { listUsuarios } from '../db/usuarios';
import { resolverMesa, alcanceMesa, listMesas } from '../db/mesas';
import { listTiposPieza } from '../db/tipos_pieza';
import { ensureSemana, getSemana, listSenales, getActa, listAcuerdosAbiertos } from '../db/semanas';
import { audit } from '../db/audit';
import { sanitizeForClient } from '../visibility';
import { fechaLocal } from '../rituals/daily';
import { capacidadSemana, generarPlanOperativo, generarActaCierre, recalcularSenales } from '../rituals/service';
import { temaAgenda } from '../rituals/signals';
import { previewProyecto, crearProyectoDesdePlantilla } from '../builder/service';
import { updateRequerimiento, getRequerimiento } from '../db/requerimientos';
import { pushDueDate } from '../basecamp/write';
import { publicarActaEnBasecamp } from './publish';
import { guardarPlan, tomarPlan, guardarResultado } from './plans';
import { buildDashboard } from '../dashboard';
import { resumenHoras } from '../horas';
import { narrarWeekly } from '../ia/weekly';
import type { CrearProyectoInput, ActualizarRequerimientoInput, Requerimiento } from '@backio/shared';

type Text = { content: { type: 'text'; text: string }[]; isError?: boolean };
const ok = (data: unknown): Text => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (msg: string): Text => ({ content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], isError: true });

const ROLES_GESTION = new Set(['admin', 'gerencia', 'operaciones', 'ejecutiva', 'lider']);
function tiene(auth: AuthInfo, ...scopes: Scope[]): boolean {
  if (auth.tipo === 'usuario') {
    if (auth.perfil === 'oauth' && !scopes.every((s) => auth.scopes.includes(s))) return false;
    const escribe = scopes.some((s) => s.startsWith('write:'));
    return !escribe || (auth.rol !== null && ROLES_GESTION.has(auth.rol));
  }
  return auth.scopes.includes('admin') || scopes.every((s) => auth.scopes.includes(s));
}
const esScopeCliente = (auth: AuthInfo) => auth.tipo === 'api_key' && auth.perfil === 'cliente';

/** Vista interna de un requerimiento para agentes: sin texto de Basecamp por construcción. */
function reqInterno(r: Requerimiento & Partial<{ dias_atraso: number; dias_sin_movimiento: number }>, nombres: Map<string, string>, clientes: Map<string, string>) {
  return {
    id: r.id, cliente: clientes.get(r.cliente_id) ?? r.cliente_id, proyecto_id: r.proyecto_id, bloque: r.bloque_nombre,
    titulo: r.titulo_interno, etiqueta_cliente: r.etiqueta_cliente, visible_cliente: r.visible_cliente,
    estado: r.estado_operativo, aprobacion: r.estado_aprobacion, prioridad: r.prioridad, tipo: r.tipo_trabajo, peso: Number(r.peso),
    fecha_pedido: r.fecha_pedido, fecha_entrega: r.fecha_entrega, veces_reprogramado: r.veces_reprogramado,
    owners: r.owner_agencia.map((id) => nombres.get(id) ?? id), piezas: r.piezas,
    dias_atraso: r.dias_atraso ?? null, dias_sin_movimiento: r.dias_sin_movimiento ?? null, basecamp_url: r.basecamp_url,
  };
}

async function mapas(ctx: DbCtx) {
  const [u, c] = await Promise.all([listUsuarios(ctx), listClientes(ctx, { incluirInactivos: true })]);
  return { nombres: new Map(u.map((x) => [x.id, x.nombre])), clientes: new Map(c.map((x) => [x.id, x.nombre])), usuarios: u, listaClientes: c };
}

async function resolverCliente(ctx: DbCtx, ref: string | undefined) {
  if (!ref) return null;
  const todos = await listClientes(ctx, { incluirInactivos: true });
  const q = ref.toLowerCase();
  return todos.find((c) => c.id === ref) ?? todos.find((c) => c.slug === q) ?? todos.find((c) => c.nombre.toLowerCase().includes(q)) ?? null;
}

export function buildMcpServer(auth: AuthInfo): McpServer {
  const ctx: DbCtx = { ...auth.ctx, origen: 'mcp' };
  const server = new McpServer({ name: 'backio', version: '0.1.0' });
  const guard = (scopes: Scope[], fn: () => Promise<Text>) => async (): Promise<Text> => {
    if (!tiene(auth, ...scopes)) return fail(`Scope requerido: ${scopes.join(', ')}`);
    try { return await fn(); } catch (err) { return fail(err instanceof DbError || err instanceof Error ? err.message : String(err)); }
  };

  // ------------------------------------------------------------ LECTURA
  server.registerTool('list_backlog', {
    description: 'Requerimientos filtrados del backlog operativo. Solo datos de BackIO; nunca comentarios de Basecamp.',
    inputSchema: {
      cliente: z.string().optional().describe('id, slug o parte del nombre del cliente'),
      owner: z.string().optional().describe('nombre o id de la persona responsable'),
      estado: z.enum(['backlog', 'priorizado', 'en_ejecucion', 'en_revision', 'reprogramado', 'bloqueado', 'completado', 'cancelado']).optional(),
      semana: z.enum(['actual']).optional().describe('"actual" limita a requerimientos con entrega en la semana ISO en curso'),
      mesa: z.string().optional().describe('nombre o slug de la mesa (Orión, Omega)'),
      min_dias_atraso: z.number().int().min(0).optional(),
      solo_activos: z.boolean().default(true),
      limite: z.number().int().min(1).max(200).default(50),
    },
  }, (args) => guard(['read:backlog'], async () => {
    if (esScopeCliente(auth)) return fail('Esta tool no está disponible con scope cliente');
    const m = await mapas(ctx);
    const cliente = await resolverCliente(ctx, args.cliente);
    if (args.cliente && !cliente) return fail(`Cliente "${args.cliente}" no encontrado`);
    const owner = args.owner ? m.usuarios.find((u) => u.id === args.owner || u.nombre.toLowerCase().includes(args.owner!.toLowerCase())) : null;
    let desde: string | undefined, hasta: string | undefined;
    if (args.semana === 'actual') { const s = await ensureSemana(ctx, fechaLocal()); desde = s.fecha_inicio; hasta = s.fecha_fin; }
    let alcance;
    if (args.mesa) { const m2 = await resolverMesa(ctx, args.mesa); if (!m2) return fail(`Mesa "${args.mesa}" no encontrada`); alcance = await alcanceMesa(ctx, m2.id); }
    const items = await listBacklog(ctx, { cliente_id: cliente?.id, owner: owner?.id, estado: args.estado, min_dias_atraso: args.min_dias_atraso, solo_activos: args.solo_activos, desde, hasta, mesa: alcance });
    return ok({ total: items.length, items: items.slice(0, args.limite).map((r) => reqInterno(r, m.nombres, m.clientes)) });
  })());

  server.registerTool('get_project_status', {
    description: 'Avance ponderado, hitos y bloqueos de un proyecto. Con scope cliente devuelve solo la vista sanitizada.',
    inputSchema: { proyecto_id: z.string().uuid() },
  }, ({ proyecto_id }) => guard(['read:proyectos'], async () => {
    const det = await getProyectoDetalle(ctx, proyecto_id);
    if (!det) return fail('Proyecto no encontrado');
    if (esScopeCliente(auth)) return ok(sanitizeForClient(det, det.requerimientos));
    const m = await mapas(ctx);
    const { requerimientos, ...p } = det;
    return ok({
      proyecto: { id: p.id, nombre: p.nombre, cliente: p.cliente_nombre, estado: p.estado, fecha_inicio: p.fecha_inicio, fecha_entrega: p.fecha_entrega, avance_interno: p.avance, portal_activo: p.portal_activo, sync_basecamp: p.sync_estado },
      vista_cliente: sanitizeForClient(det, requerimientos),
      requerimientos: requerimientos.map((r) => reqInterno(r, m.nombres, m.clientes)),
    });
  })());

  server.registerTool('get_weekly_signals', {
    description: 'Señales del motor del weekly ordenadas por severidad, con el tema de agenda que disparan. Por defecto la semana actual.',
    inputSchema: { semana_id: z.string().uuid().optional(), recalcular: z.boolean().default(false).describe('Recalcula las señales antes de devolverlas') },
  }, ({ semana_id, recalcular }) => guard(['read:senales'], async () => {
    if (esScopeCliente(auth)) return fail('No disponible con scope cliente');
    const semana = semana_id ? await getSemana(ctx, semana_id) : await ensureSemana(ctx, fechaLocal());
    if (!semana) return fail('Semana no encontrada');
    const senales = recalcular && tiene(auth, 'write:actas') ? await recalcularSenales(ctx, semana.id) : await listSenales(ctx, semana.id);
    const abiertos = await listAcuerdosAbiertos(ctx);
    return ok({
      semana: { id: semana.id, numero_iso: semana.numero_iso, inicio: semana.fecha_inicio, fin: semana.fecha_fin },
      total: senales.length,
      senales: senales.map((s) => ({ tipo: s.tipo, severidad: s.severidad, titulo: s.titulo, tema_agenda: temaAgenda(s.tipo), atendida: s.atendida, detalle: s.detalle })),
      acuerdos_abiertos: abiertos.length,
    });
  })());

  server.registerTool('get_capacity', {
    description: 'Carga por persona en la semana (tareas asignadas vs capacidad declarada en horas).',
    inputSchema: { semana_id: z.string().uuid().optional() },
  }, ({ semana_id }) => guard(['read:capacidad'], async () => {
    if (esScopeCliente(auth)) return fail('No disponible con scope cliente');
    const semana = semana_id ? await getSemana(ctx, semana_id) : await ensureSemana(ctx, fechaLocal());
    if (!semana) return fail('Semana no encontrada');
    return ok({ semana: { id: semana.id, numero_iso: semana.numero_iso }, personas: await capacidadSemana(ctx, semana.id) });
  })());

  server.registerTool('get_client_health', {
    description: 'Salud de una cuenta: proyectos activos, atrasos, días sin movimiento, esperas del cliente.',
    inputSchema: { cliente: z.string().describe('id, slug o parte del nombre') },
  }, ({ cliente }) => guard(['read:proyectos'], async () => {
    const c = await resolverCliente(ctx, cliente);
    if (!c) return fail(`Cliente "${cliente}" no encontrado`);
    const [proyectos, activos] = await Promise.all([listProyectos(ctx, { cliente_id: c.id }), listBacklog(ctx, { cliente_id: c.id, solo_activos: true })]);
    const enCurso = proyectos.filter((p) => !['completado', 'cancelado'].includes(p.estado));
    const salida = {
      cliente: c.nombre, cliente_id: c.id, activo: c.activo,
      proyectos_activos: enCurso.map((p) => ({ id: p.id, nombre: p.nombre, avance: p.avance, entrega: p.fecha_entrega, estado: p.estado })),
      requerimientos_activos: activos.length,
      atrasados: activos.filter((r) => r.dias_atraso > 0).length,
      dias_sin_movimiento_min: activos.length ? Math.min(...activos.map((r) => r.dias_sin_movimiento)) : null,
      esperando_cliente: activos.filter((r) => r.estado_aprobacion === 'pendiente_cliente').map((r) => ({ titulo: esScopeCliente(auth) ? r.etiqueta_cliente : r.titulo_interno, dias: r.dias_sin_movimiento })).filter((x) => x.titulo),
    };
    return ok(salida);
  })());

  server.registerTool('search_requirements', {
    description: 'Búsqueda de texto en títulos internos de requerimientos.',
    inputSchema: { query: z.string().min(2), limite: z.number().int().min(1).max(100).default(30) },
  }, ({ query, limite }) => guard(['read:backlog'], async () => {
    if (esScopeCliente(auth)) return fail('No disponible con scope cliente');
    const m = await mapas(ctx);
    const items = await listBacklog(ctx, { query });
    return ok({ total: items.length, items: items.slice(0, limite).map((r) => reqInterno(r, m.nombres, m.clientes)) });
  })());

  server.registerTool('list_clients_and_templates', {
    description: 'Catálogo: clientes activos, plantillas disponibles (con sus bloques) y personas del equipo. Útil antes de planificar un proyecto.',
    inputSchema: {},
  }, () => guard(['read:proyectos'], async () => {
    if (esScopeCliente(auth)) return fail('No disponible con scope cliente');
    const [clientes, plantillas, usuarios] = await Promise.all([listClientes(ctx), listPlantillas(ctx), listUsuarios(ctx)]);
    const arboles = await Promise.all(plantillas.map((p) => getPlantillaArbol(ctx, p.id)));
    return ok({
      clientes: clientes.map((c) => ({ id: c.id, nombre: c.nombre, slug: c.slug, basecamp_configurado: !!c.basecamp_project_id })),
      plantillas: arboles.filter(Boolean).map((p) => ({ id: p!.id, nombre: p!.nombre, tipo: p!.tipo, bloques: p!.bloques.map((b) => ({ id: b.id, nombre: b.nombre, peso: b.peso, opcional: b.opcional, tareas: b.tareas.length })) })),
      tipos_pieza: (await listTiposPieza(ctx)).map((t) => ({ id: t.id, slug: t.slug, nombre: t.nombre, esfuerzo: t.esfuerzo, pasos: t.pasos.map((p) => p.titulo) })),
      equipo: usuarios.map((u) => ({ id: u.id, nombre: u.nombre, rol: u.rol, capacidad_semanal: u.capacidad_semanal })),
    });
  })());

  server.registerTool('get_dashboard', {
    description: 'KPIs de la agencia o de una mesa: activos, atrasados, sin movimiento, esperando cliente, salud por cliente, carga por persona, arrastre y serie de 8 semanas.',
    inputSchema: { mesa: z.string().optional().describe('nombre o slug de la mesa; vacío = toda la agencia') },
  }, ({ mesa }) => guard(['read:backlog', 'read:proyectos'], async () => {
    if (esScopeCliente(auth)) return fail('No disponible con scope cliente');
    let mesaId: string | null = null;
    if (mesa) { const m = await resolverMesa(ctx, mesa); if (!m) return fail(`Mesa "${mesa}" no encontrada`); mesaId = m.id; }
    return ok(await buildDashboard(ctx, mesaId));
  })());

  server.registerTool('get_hours', {
    description: 'Horas registradas en Basecamp (timesheet) por cliente, persona y proyecto en los últimos N días. Solo números; nunca la descripción de las entradas.',
    inputSchema: { dias: z.number().int().min(1).max(365).default(30) },
  }, ({ dias }) => guard(['read:backlog'], async () => {
    if (esScopeCliente(auth)) return fail('No disponible con scope cliente');
    const m = await mapas(ctx);
    const r = await resumenHoras(ctx, new Date(Date.now() - dias * 86_400_000).toISOString());
    return ok({ dias, total: r.total, por_cliente: Object.fromEntries(Object.entries(r.por_cliente).map(([k, v]) => [m.clientes.get(k) ?? k, v])), por_persona: Object.fromEntries(Object.entries(r.por_usuario).map(([k, v]) => [m.nombres.get(k) ?? k, v])) });
  })());

  server.registerTool('get_weekly_narrative', {
    description: 'Status semanal narrado por la IA de BackIO + agenda agrupada por causa con una pregunta de decisión por grupo. Solo lectura; se alimenta de datos estructurados (nunca texto de Basecamp).',
    inputSchema: { mesa: z.string().optional().describe('id, slug o nombre de la mesa; vacío = toda la agencia') },
  }, ({ mesa }) => guard(['read:senales'], async () => {
    if (esScopeCliente(auth)) return fail('No disponible con scope cliente');
    const m = mesa ? await resolverMesa(ctx, mesa) : null;
    if (mesa && !m) return fail(`Mesa no encontrada: ${mesa}`);
    const semana = await ensureSemana(ctx, fechaLocal());
    return ok(await narrarWeekly(ctx, semana.id, m?.id ?? null));
  })());

  // ------------------------------------------------------------ ESCRITURA (preview + confirm)
  server.registerTool('plan_project_from_template', {
    description: 'Devuelve un PLAN para crear un proyecto desde plantilla (requerimientos, fechas, pesos, vista cliente, advertencias). NO ejecuta. Para ejecutar, llamar confirm_plan con el plan_id dentro de 15 minutos.',
    inputSchema: {
      plantilla: z.string().describe('id o nombre de la plantilla'),
      cliente: z.string().describe('id, slug o nombre del cliente'),
      nombre: z.string().min(3),
      fecha_entrega: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      brief: z.object({ objetivo_negocio: z.string(), publico_objetivo: z.string(), canales: z.array(z.string()).min(1), mandatorios_marca: z.string().optional() }),
      bloques: z.array(z.object({ bloque_id: z.string().uuid(), activo: z.boolean().default(true), owner: z.string().nullable().optional().describe('nombre o id'), piezas_por_canal: z.record(z.number().int().min(0)).default({}), piezas: z.record(z.number().int().min(0)).default({}).describe('cantidades por tipo de pieza: {"reel": 4, "post": 8, "carrusel": 2}') })).default([]),
    },
  }, (args) => guard(['write:proyectos'], async () => {
    const c = await resolverCliente(ctx, args.cliente);
    if (!c) return fail(`Cliente "${args.cliente}" no encontrado`);
    const plantillas = await listPlantillas(ctx);
    const pl = plantillas.find((p) => p.id === args.plantilla) ?? plantillas.find((p) => p.nombre.toLowerCase().includes(args.plantilla.toLowerCase()));
    if (!pl) return fail(`Plantilla "${args.plantilla}" no encontrada. Disponibles: ${plantillas.map((p) => p.nombre).join(', ')}`);
    const [usuarios, tipos] = await Promise.all([listUsuarios(ctx), listTiposPieza(ctx)]);
    const tipoId = (k: string) => tipos.find((t) => t.slug === k.toLowerCase() || t.nombre.toLowerCase() === k.toLowerCase() || t.id === k)?.id;
    const input: CrearProyectoInput = {
      cliente_id: c.id, plantilla_id: pl.id, nombre: args.nombre, fecha_entrega: args.fecha_entrega, brief: args.brief,
      bloques: args.bloques.map((b) => ({
        bloque_id: b.bloque_id, activo: b.activo, piezas_por_canal: b.piezas_por_canal,
        piezas_por_tipo: Object.fromEntries(Object.entries(b.piezas).map(([k, v]) => [tipoId(k) ?? k, v]).filter(([k]) => tipos.some((t) => t.id === k))),
        owner_id: b.owner ? (usuarios.find((u) => u.id === b.owner || u.nombre.toLowerCase().includes(b.owner!.toLowerCase()))?.id ?? null) : null,
      })),
    };
    const preview = await previewProyecto(ctx, input);
    const { plan_id, expira_en } = await guardarPlan(ctx, 'plan_project_from_template', input, preview.resumen);
    await audit(ctx, { accion: 'mcp_plan', entidad: 'proyecto', detalle: { tool: 'plan_project_from_template', plan_id, resumen: preview.resumen } });
    return ok({
      plan_id, expira_en,
      resumen: `Crear proyecto "${args.nombre}" para ${c.nombre} con plantilla ${pl.nombre}`,
      cambios: { proyectos_a_crear: 1, requerimientos_a_crear: preview.resumen.requerimientos_a_crear, todos_basecamp_a_crear: preview.resumen.todos_basecamp_a_crear, visibles_al_cliente: preview.resumen.visibles_al_cliente },
      detalle: preview.plan.tareas.map((t) => ({ bloque: t.bloque_nombre, titulo: t.titulo_interno, etiqueta_cliente: t.etiqueta_cliente, visible: t.visible_cliente, peso: t.peso, fecha_entrega: t.fecha_entrega, owners: t.owner_agencia.map((id) => usuarios.find((u) => u.id === id)?.nombre ?? id) })),
      vista_cliente: preview.vista_cliente,
      advertencias: preview.alertas.map((a) => `${a.nombre} quedaría con ${a.tareas} de ${a.total} tareas en la semana del ${a.semana_inicio} (${a.pct}%)`),
      siguiente_paso: 'Si el plan es correcto, llama confirm_plan con este plan_id.',
    });
  })());

  server.registerTool('plan_requirement_update', {
    description: 'Devuelve el DIFF de una actualización de requerimiento (estado, prioridad, fecha, aprobación, owners). NO aplica. Confirmar con confirm_plan.',
    inputSchema: {
      requerimiento_id: z.string().uuid(),
      cambios: z.object({
        estado_operativo: z.enum(['backlog', 'priorizado', 'en_ejecucion', 'en_revision', 'reprogramado', 'bloqueado', 'cancelado']).optional(),
        estado_aprobacion: z.enum(['no_aplica', 'pendiente_interno', 'pendiente_cliente', 'aprobado', 'rechazado']).optional(),
        prioridad: z.enum(['alta', 'media', 'baja']).optional(),
        fecha_entrega: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        owners: z.array(z.string()).optional().describe('nombres o ids'),
        piezas: z.number().int().min(0).optional(),
      }),
    },
  }, ({ requerimiento_id, cambios }) => guard(['write:requerimientos'], async () => {
    const r = await getRequerimiento(ctx, requerimiento_id);
    if (!r) return fail('Requerimiento no encontrado');
    const usuarios = await listUsuarios(ctx);
    const patch: ActualizarRequerimientoInput = {};
    if (cambios.estado_operativo) patch.estado_operativo = cambios.estado_operativo;
    if (cambios.estado_aprobacion) patch.estado_aprobacion = cambios.estado_aprobacion;
    if (cambios.prioridad) patch.prioridad = cambios.prioridad;
    if (cambios.fecha_entrega) patch.fecha_entrega = cambios.fecha_entrega;
    if (cambios.piezas !== undefined) patch.piezas = cambios.piezas;
    if (cambios.owners) patch.owner_agencia = cambios.owners.map((o) => usuarios.find((u) => u.id === o || u.nombre.toLowerCase().includes(o.toLowerCase()))?.id).filter((x): x is string => !!x);
    const diff = Object.entries(patch).map(([k, v]) => ({ campo: k, antes: (r as unknown as Record<string, unknown>)[k], despues: v }));
    if (diff.length === 0) return fail('Sin cambios que aplicar');
    const { plan_id, expira_en } = await guardarPlan(ctx, 'plan_requirement_update', { requerimiento_id, patch }, diff);
    return ok({ plan_id, expira_en, requerimiento: r.titulo_interno, diff, nota: patch.fecha_entrega ? 'Cambiar fecha_entrega cuenta como reprogramación y se refleja en Basecamp (due_on).' : undefined, siguiente_paso: 'Confirmar con confirm_plan.' });
  })());

  server.registerTool('generate_weekly_plan', {
    description: 'Genera el Plan Operativo Semanal (markdown en el formato de Geeks). No publica.',
    inputSchema: { semana_id: z.string().uuid().optional(), mesa: z.string().describe('Mesa (Orión, Omega): el acta se publica en su proyecto Basecamp') },
  }, ({ semana_id, mesa }) => guard(['write:actas'], async () => {
    const semana = semana_id ? await getSemana(ctx, semana_id) : await ensureSemana(ctx, fechaLocal());
    if (!semana) return fail('Semana no encontrada');
    const m = await resolverMesa(ctx, mesa);
    if (!m) return fail(`Mesa "${mesa}" no encontrada. Disponibles: ${(await listMesas(ctx)).map((x) => x.nombre).join(', ')}`);
    const acta = await generarPlanOperativo(ctx, semana.id, m.id);
    await audit(ctx, { accion: 'generar_plan_operativo', entidad: 'acta', entidad_id: acta.id });
    return ok({ acta_id: acta.id, tipo: acta.tipo, markdown: acta.markdown, siguiente_paso: 'Revisar y, si procede, publish_document con acta_id.' });
  })());

  server.registerTool('generate_closing_minutes', {
    description: 'Genera el Acta de Cierre de la semana (markdown). No publica.',
    inputSchema: { semana_id: z.string().uuid().optional(), mesa: z.string().describe('Mesa (Orión, Omega): el acta se publica en su proyecto Basecamp') },
  }, ({ semana_id, mesa }) => guard(['write:actas'], async () => {
    const semana = semana_id ? await getSemana(ctx, semana_id) : await ensureSemana(ctx, fechaLocal());
    if (!semana) return fail('Semana no encontrada');
    const m = await resolverMesa(ctx, mesa);
    if (!m) return fail(`Mesa "${mesa}" no encontrada. Disponibles: ${(await listMesas(ctx)).map((x) => x.nombre).join(', ')}`);
    const acta = await generarActaCierre(ctx, semana.id, m.id);
    await audit(ctx, { accion: 'generar_acta_cierre', entidad: 'acta', entidad_id: acta.id });
    return ok({ acta_id: acta.id, tipo: acta.tipo, markdown: acta.markdown, siguiente_paso: 'Revisar y, si procede, publish_document con acta_id.' });
  })());

  server.registerTool('publish_document', {
    description: 'Publica un acta generada como Documento en el proyecto Basecamp de operaciones del tenant. Requiere que el acta exista y no haya sido publicada.',
    inputSchema: { acta_id: z.string().uuid() },
  }, ({ acta_id }) => guard(['write:actas'], async () => {
    const acta = await getActa(ctx, acta_id);
    if (!acta) return fail('Acta no encontrada');
    if (acta.publicado_at) return fail('El acta ya fue publicada');
    const r = await publicarActaEnBasecamp(ctx, acta);
    await audit(ctx, { accion: 'publicar_acta', entidad: 'acta', entidad_id: acta.id, detalle: r });
    return ok(r);
  })());

  server.registerTool('confirm_plan', {
    description: 'Ejecuta un plan generado por plan_project_from_template o plan_requirement_update. El plan_id expira en 15 minutos y es de un solo uso.',
    inputSchema: { plan_id: z.string().regex(/^plan_[0-9a-f]{12}$/) },
  }, ({ plan_id }) => guard([], async () => {
    const plan = await tomarPlan(ctx, plan_id);
    if (plan.tool === 'plan_project_from_template') {
      if (!tiene(auth, 'write:proyectos')) return fail('Scope requerido: write:proyectos');
      const r = await crearProyectoDesdePlantilla(ctx, plan.parametros as CrearProyectoInput);
      const salida = { proyecto_id: r.proyecto.id, nombre: r.proyecto.nombre, requerimientos_creados: r.requerimientos.length, basecamp: r.basecamp, portal_token: r.proyecto.portal_token };
      await guardarResultado(ctx, plan_id, salida);
      await audit(ctx, { accion: 'mcp_confirm', entidad: 'proyecto', entidad_id: r.proyecto.id, detalle: { plan_id } });
      return ok(salida);
    }
    if (plan.tool === 'plan_requirement_update') {
      if (!tiene(auth, 'write:requerimientos')) return fail('Scope requerido: write:requerimientos');
      const { requerimiento_id, patch } = plan.parametros as { requerimiento_id: string; patch: ActualizarRequerimientoInput };
      const previo = await getRequerimiento(ctx, requerimiento_id);
      const r = await updateRequerimiento(ctx, requerimiento_id, patch);
      const reprogramado = patch.fecha_entrega !== undefined && patch.fecha_entrega !== previo?.fecha_entrega;
      await audit(ctx, { accion: reprogramado ? 'reprogramar' : 'actualizar', entidad: 'requerimiento', entidad_id: requerimiento_id, detalle: { plan_id, ...patch } });
      if (reprogramado && r.basecamp_todo_id) pushDueDate(ctx, r).catch((e) => console.error('[mcp] due_on', e));
      await guardarResultado(ctx, plan_id, { ok: true });
      return ok({ ok: true, requerimiento_id, aplicado: patch });
    }
    return fail(`Tool de plan desconocida: ${plan.tool}`);
  })());

  return server;
}
