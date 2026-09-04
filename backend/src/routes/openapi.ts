/**
 * Spec OpenAPI 3.1 de /api/v1 generada desde los mismos esquemas zod de las rutas.
 * Consumida por Gemini (function calling vía OpenAPI) y cualquier cliente REST.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD');
const ESTADOS = ['backlog', 'priorizado', 'en_ejecucion', 'en_revision', 'reprogramado', 'bloqueado', 'completado', 'cancelado'] as const;
const APROB = ['no_aplica', 'pendiente_interno', 'pendiente_cliente', 'aprobado', 'rechazado'] as const;

export const schemas = {
  Requerimiento: z.object({
    id: z.string().uuid(), cliente_id: z.string().uuid(), proyecto_id: z.string().uuid().nullable(), bloque_nombre: z.string().nullable(),
    titulo_interno: z.string(), etiqueta_cliente: z.string().nullable(), visible_cliente: z.boolean(),
    tipo_trabajo: z.enum(['fee', 'proyecto']), estado_operativo: z.enum(ESTADOS), estado_aprobacion: z.enum(APROB), prioridad: z.enum(['alta', 'media', 'baja']),
    peso: z.number(), fecha_pedido: fecha.nullable(), fecha_entrega: fecha.nullable(), veces_reprogramado: z.number().int(),
    owner_agencia: z.array(z.string().uuid()), piezas: z.number().int(), basecamp_url: z.string().nullable(),
    dias_atraso: z.number().int().optional(), dias_sin_movimiento: z.number().int().optional(),
  }),
  CrearRequerimiento: z.object({
    cliente_id: z.string().uuid(), proyecto_id: z.string().uuid().nullable().optional(), titulo_interno: z.string().min(2),
    etiqueta_cliente: z.string().nullable().optional(), visible_cliente: z.boolean().default(false), bloque_nombre: z.string().nullable().optional(),
    tipo_trabajo: z.enum(['fee', 'proyecto']).default('fee'), prioridad: z.enum(['alta', 'media', 'baja']).default('media'), peso: z.number().min(0).default(1),
    fecha_pedido: fecha.nullable().optional(), fecha_entrega: fecha.nullable().optional(), owner_agencia: z.array(z.string().uuid()).default([]), piezas: z.number().int().min(0).default(0),
  }),
  ActualizarRequerimiento: z.object({
    titulo_interno: z.string().optional(), etiqueta_cliente: z.string().nullable().optional(), visible_cliente: z.literal(false).optional(),
    estado_operativo: z.enum(ESTADOS).optional(), estado_aprobacion: z.enum(APROB).optional(), prioridad: z.enum(['alta', 'media', 'baja']).optional(),
    peso: z.number().optional(), fecha_entrega: fecha.nullable().optional(), fecha_pedido: fecha.nullable().optional(), owner_agencia: z.array(z.string().uuid()).optional(), piezas: z.number().int().optional(),
  }),
  CrearProyecto: z.object({
    cliente_id: z.string().uuid(), plantilla_id: z.string().uuid(), nombre: z.string().min(3), fecha_entrega: fecha,
    brief: z.object({ objetivo_negocio: z.string(), publico_objetivo: z.string(), canales: z.array(z.string()).min(1), mandatorios_marca: z.string().optional() }),
    bloques: z.array(z.object({ bloque_id: z.string().uuid(), activo: z.boolean(), owner_id: z.string().uuid().nullable(), piezas_por_canal: z.record(z.number().int()) })).default([]),
  }),
  Proyecto: z.object({ id: z.string().uuid(), cliente_id: z.string().uuid(), nombre: z.string(), estado: z.enum(ESTADOS), fecha_inicio: fecha, fecha_entrega: fecha, avance: z.number().optional(), cliente_nombre: z.string().optional(), portal_activo: z.boolean() }),
  Cliente: z.object({ id: z.string().uuid(), nombre: z.string(), slug: z.string(), activo: z.boolean(), mesa_id: z.string().uuid().nullable() }),
  Plantilla: z.object({ id: z.string().uuid(), nombre: z.string(), tipo: z.string(), descripcion: z.string().nullable() }),
  Senal: z.object({ id: z.string().uuid(), tipo: z.string(), severidad: z.enum(['critica', 'alta', 'media']), titulo: z.string(), atendida: z.boolean(), detalle: z.record(z.unknown()) }),
  Acuerdo: z.object({ descripcion: z.string().min(3), responsable_id: z.string().uuid(), fecha_compromiso: fecha }),
  ResumenCliente: z.object({ cliente_id: z.string().uuid(), proyectos_activos: z.number().int(), requerimientos_atrasados: z.number().int(), dias_sin_movimiento: z.number().int(), esperando_cliente: z.number().int() }),
  Error: z.object({ error: z.string() }),
};

function ref(name: keyof typeof schemas) { return { $ref: `#/components/schemas/${name}` }; }
const lista = (name: keyof typeof schemas) => ({ type: 'object', properties: { items: { type: 'array', items: ref(name) }, total: { type: 'integer' } } });
const json = (schema: unknown) => ({ 'application/json': { schema } });
const q = (name: string, description: string, schema: Record<string, unknown> = { type: 'string' }) => ({ name, in: 'query', description, schema });
const path = (name: string) => ({ name, in: 'path', required: true, schema: { type: 'string', format: 'uuid' } });
const okList = (name: keyof typeof schemas) => ({ '200': { description: 'OK', content: json(lista(name)) } });
const okOne = (name: keyof typeof schemas) => ({ '200': { description: 'OK', content: json(ref(name)) }, '404': { description: 'No encontrado', content: json(ref('Error')) } });

export function buildSpec(base: string) {
  const components: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schemas)) {
    const js = zodToJsonSchema(v, { target: 'openApi3', $refStrategy: 'none' }) as Record<string, unknown>;
    delete js.$schema;
    components[k] = js;
  }
  return {
    openapi: '3.1.0',
    info: { title: 'BackIO API', version: '1.0.0', description: 'Backlog operativo de Geeks Ecuador. Auth: Bearer API key (bk_live_…) con scopes. Nunca expone texto de Basecamp.' },
    servers: [{ url: `${base}/api/v1` }],
    security: [{ bearerAuth: [] }],
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } }, schemas: components },
    paths: {
      '/clientes': { get: { operationId: 'listClientes', summary: 'Lista de clientes', parameters: [q('todos', '1 para incluir inactivos')], responses: okList('Cliente') } },
      '/clientes/{id}/resumen': { get: { operationId: 'getClienteResumen', summary: 'Resumen de entrega de un cliente (widget PrometIO)', parameters: [path('id')], responses: okOne('ResumenCliente') } },
      '/plantillas': { get: { operationId: 'listPlantillas', summary: 'Plantillas disponibles', responses: okList('Plantilla') } },
      '/proyectos': {
        get: { operationId: 'listProyectos', summary: 'Proyectos', parameters: [q('cliente', 'uuid del cliente'), q('estado', 'estado operativo', { type: 'string', enum: [...ESTADOS] })], responses: okList('Proyecto') },
        post: { operationId: 'crearProyecto', summary: 'Crear proyecto desde plantilla (crea to-dos en Basecamp)', requestBody: { required: true, content: json(ref('CrearProyecto')) }, responses: { '201': { description: 'Creado' } } },
      },
      '/proyectos/preview': { post: { operationId: 'previewProyecto', summary: 'Plan y vista cliente sin crear nada', requestBody: { required: true, content: json(ref('CrearProyecto')) }, responses: { '200': { description: 'Preview' } } } },
      '/proyectos/{id}': { get: { operationId: 'getProyecto', summary: 'Detalle con requerimientos', parameters: [path('id')], responses: okOne('Proyecto') } },
      '/proyectos/{id}/vista-cliente': { get: { operationId: 'getVistaCliente', summary: 'Exactamente lo que ve el cliente en el portal', parameters: [path('id')], responses: { '200': { description: 'ClientSafeProject' } } } },
      '/requerimientos': {
        get: { operationId: 'listBacklog', summary: 'Backlog filtrado', parameters: [q('cliente', 'uuid'), q('proyecto', 'uuid'), q('owner', 'uuid usuario'), q('estado', 'estado operativo', { type: 'string', enum: [...ESTADOS] }), q('activos', '1 = excluir completados/cancelados'), q('min_dias_atraso', 'entero'), q('desde', 'fecha_entrega >= YYYY-MM-DD'), q('hasta', 'fecha_entrega <= YYYY-MM-DD'), q('q', 'texto en título interno')], responses: okList('Requerimiento') },
        post: { operationId: 'crearRequerimiento', summary: 'Crear requerimiento', requestBody: { required: true, content: json(ref('CrearRequerimiento')) }, responses: { '201': { description: 'Creado', content: json(ref('Requerimiento')) } } },
      },
      '/requerimientos/{id}': {
        get: { operationId: 'getRequerimiento', summary: 'Un requerimiento', parameters: [path('id')], responses: okOne('Requerimiento') },
        patch: { operationId: 'actualizarRequerimiento', summary: 'Actualizar (no se puede abrir visibilidad ni completar si vive en Basecamp)', parameters: [path('id')], requestBody: { required: true, content: json(ref('ActualizarRequerimiento')) }, responses: okOne('Requerimiento') },
      },
      '/semanas/actual': { get: { operationId: 'getSemanaActual', summary: 'Semana ISO en curso', responses: { '200': { description: 'Semana' } } } },
      '/semanas/{id}/senales': { get: { operationId: 'getSenales', summary: 'Señales del weekly', parameters: [path('id')], responses: okList('Senal') } },
      '/semanas/{id}/capacidad': { get: { operationId: 'getCapacidad', summary: 'Carga por persona', parameters: [path('id')], responses: { '200': { description: 'Capacidad' } } } },
      '/semanas/{id}/acuerdos': { post: { operationId: 'crearAcuerdo', summary: 'Acuerdo del weekly (fecha real obligatoria)', parameters: [path('id')], requestBody: { required: true, content: json(ref('Acuerdo')) }, responses: { '201': { description: 'Creado' } } } },
      '/semanas/{id}/plan': { post: { operationId: 'generarPlanOperativo', summary: 'Generar Plan Operativo (markdown)', parameters: [path('id'), q('mesa', 'uuid de la mesa')], responses: { '201': { description: 'Acta' } } } },
      '/semanas/{id}/acta': { post: { operationId: 'generarActaCierre', summary: 'Generar Acta de Cierre (markdown)', parameters: [path('id'), q('mesa', 'uuid de la mesa')], responses: { '201': { description: 'Acta' } } } },
      '/semanas/daily': { get: { operationId: 'getDaily', summary: 'Las tres señales del daily', responses: { '200': { description: 'DailyView' } } } },
      '/dashboard': { get: { operationId: 'getDashboard', summary: 'KPIs, salud por cliente, carga por persona, arrastre, serie 8 semanas', parameters: [q('mesa', 'uuid de la mesa')], responses: { '200': { description: 'Dashboard' } } } },
      '/mesas': { get: { operationId: 'listMesas', summary: 'Mesas (equipos de cuenta)', responses: { '200': { description: 'Mesas' } } } },
      '/horas/resumen': { get: { operationId: 'getHoras', summary: 'Horas de Basecamp (timesheet) por cliente, persona, proyecto y requerimiento. Solo números', parameters: [q('dias', 'ventana en días (default 30)')], responses: { '200': { description: 'ResumenHoras' } } } },
      '/huerfanos': { get: { operationId: 'listHuerfanos', summary: 'To-dos creados en Basecamp fuera de BackIO (solo título, fechas, creador)', responses: { '200': { description: 'Huérfanos pendientes' } } } },
      '/huerfanos/{id}/adoptar': { post: { operationId: 'adoptarHuerfano', summary: 'Crear el requerimiento en BackIO enlazado al to-do', parameters: [path('id')], responses: { '200': { description: 'Requerimiento' } } } },
      '/ia/weekly': { post: { operationId: 'narrarWeekly', summary: 'Status semanal narrado por IA + agenda por causa con pregunta de decisión (solo redacta)', requestBody: { required: true, content: json({ type: 'object', properties: { semana_id: { type: 'string' }, mesa_id: { type: 'string', nullable: true } }, required: ['semana_id'] }) }, responses: { '200': { description: 'WeeklyIA' } } } },
      '/ia/brief': { post: { operationId: 'briefDesdeTexto', summary: 'Convierte el pedido de un cliente en brief estructurado + plantilla y piezas sugeridas', requestBody: { required: true, content: json({ type: 'object', properties: { texto: { type: 'string' }, cliente_id: { type: 'string', nullable: true } }, required: ['texto'] }) }, responses: { '200': { description: 'BriefIA' } } } },
      '/ia/informe-mensual': { post: { operationId: 'informeMensual', summary: 'Informe ejecutivo mensual por mesa (se guarda como acta; una persona lo publica)', requestBody: { required: true, content: json({ type: 'object', properties: { mesa_id: { type: 'string' }, mes: { type: 'string', example: '2026-08' } }, required: ['mesa_id', 'mes'] }) }, responses: { '201': { description: 'Acta' } } } },
    },
  };
}

export const openapi = new Hono();
openapi.get('/', (c) => c.json(buildSpec((process.env.BACKEND_PUBLIC_URL ?? `${new URL(c.req.url).protocol}//${new URL(c.req.url).host}`).replace(/\/$/, ''))));
