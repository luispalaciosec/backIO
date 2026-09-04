/**
 * Creación de proyectos desde plantilla. Único camino: lo usan la ruta REST (Builder) y la
 * tool MCP confirm_plan. Si divergen, el preview miente.
 */
import type { CrearProyectoInput, Proyecto, Requerimiento, ClientSafeProject } from '@backio/shared';
import { sanitizeForClient } from '@backio/shared';
import type { DbCtx } from '../db/client';
import { DbError } from '../db/client';
import { getPlantillaArbol } from '../db/plantillas';
import { getCliente } from '../db/clientes';
import { insertProyecto, updateProyecto } from '../db/proyectos';
import { insertRequerimientos } from '../db/requerimientos';
import { listUsuarios } from '../db/usuarios';
import { audit } from '../db/audit';
import { notificar } from '../notificaciones';
import { createProjectStructure } from '../basecamp/write';
import { generarPortalToken } from '../portal/token';
import { planificarProyecto, restarDias, type PlanProyecto, type AlertaCapacidad } from './plan';

export interface PreviewProyecto {
  plan: PlanProyecto;
  vista_cliente: ClientSafeProject;
  alertas: (AlertaCapacidad & { nombre: string })[];
  resumen: { requerimientos_a_crear: number; visibles_al_cliente: number; todos_basecamp_a_crear: number; cliente: string; plantilla: string };
}

export async function previewProyecto(ctx: DbCtx, input: CrearProyectoInput): Promise<PreviewProyecto> {
  const [plantilla, cliente, usuarios] = await Promise.all([getPlantillaArbol(ctx, input.plantilla_id), getCliente(ctx, input.cliente_id), listUsuarios(ctx)]);
  if (!plantilla) throw new DbError('Plantilla no encontrada', 404);
  if (!cliente) throw new DbError('Cliente no encontrado', 404);
  const plan = planificarProyecto({ plantilla, fecha_entrega: input.fecha_entrega, bloques: input.bloques ?? [] });
  const ahora = new Date().toISOString();
  const vista_cliente = sanitizeForClient(
    { nombre: input.nombre, fecha_entrega: input.fecha_entrega },
    plan.tareas.map((t, i) => ({
      id: `preview-${i}`, etiqueta_cliente: t.etiqueta_cliente, visible_cliente: t.visible_cliente, peso: t.peso,
      estado_operativo: 'backlog', estado_aprobacion: 'no_aplica', fecha_entrega: t.fecha_entrega, ultima_actualizacion: ahora,
    })),
  );
  return {
    plan,
    vista_cliente,
    alertas: plan.alertas.map((a) => ({ ...a, nombre: usuarios.find((u) => u.id === a.owner_id)?.nombre ?? a.owner_id })),
    resumen: {
      requerimientos_a_crear: plan.tareas.length,
      visibles_al_cliente: plan.visibles,
      todos_basecamp_a_crear: cliente.basecamp_project_id ? plan.tareas.length : 0,
      cliente: cliente.nombre,
      plantilla: plantilla.nombre,
    },
  };
}

export interface ResultadoCreacion {
  proyecto: Proyecto;
  requerimientos: Requerimiento[];
  alertas: AlertaCapacidad[];
  basecamp: unknown;
}

export async function crearProyectoDesdePlantilla(ctx: DbCtx, input: CrearProyectoInput): Promise<ResultadoCreacion> {
  const [plantilla, cliente] = await Promise.all([getPlantillaArbol(ctx, input.plantilla_id), getCliente(ctx, input.cliente_id)]);
  if (!plantilla) throw new DbError('Plantilla no encontrada', 404);
  if (!cliente) throw new DbError('Cliente no encontrado', 404);

  const plan = planificarProyecto({ plantilla, fecha_entrega: input.fecha_entrega, bloques: input.bloques ?? [] });
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

  const requerimientos = await insertRequerimientos(
    ctx,
    plan.tareas.map((t) => ({
      cliente_id: input.cliente_id, proyecto_id: proyecto.id, bloque_nombre: t.bloque_nombre, plantilla_tarea_id: t.plantilla_tarea_id,
      titulo_interno: t.titulo_interno, etiqueta_cliente: t.etiqueta_cliente, visible_cliente: t.visible_cliente,
      tipo_trabajo: 'proyecto', estado_operativo: 'priorizado', peso: t.peso, fecha_pedido: fecha_inicio, fecha_entrega: t.fecha_entrega,
      owner_agencia: t.owner_agencia, piezas: t.piezas,
    })),
  );

  await audit(ctx, { accion: 'crear_proyecto', entidad: 'proyecto', entidad_id: proyecto.id, detalle: { requerimientos: requerimientos.length, visibles: plan.visibles, alertas: plan.alertas, origen: ctx.origen } });

  // Si nació de una cotización de PrometIO, el borrador queda convertido.
  if (input.prometio_cotizacion_id) {
    await ctx.db.from('proyecto_borradores').update({ estado: 'convertido', proyecto_id: proyecto.id })
      .eq('tenant_id', ctx.tenantId).eq('prometio_cotizacion_id', input.prometio_cotizacion_id);
  }

  const owners = [...new Set(plan.tareas.flatMap((t) => t.owner_agencia))].filter((id) => id !== ctx.usuarioId);
  if (owners.length) {
    void notificar(ctx, {
      tipo: 'proyecto_asignado',
      titulo: `Nuevo proyecto: ${proyecto.nombre} (${cliente.nombre})`,
      cuerpo: `Se te asignaron tareas en el proyecto "${proyecto.nombre}" de ${cliente.nombre}. Entrega final: ${input.fecha_entrega}.`,
      ruta: `/proyectos/${proyecto.id}`, entidad_tipo: 'proyecto', entidad_id: proyecto.id,
    }, { usuarioIds: owners }).catch((e) => console.error('[notificar] proyecto', e));
  }

  let basecamp: unknown = { omitido: true, motivo: 'cliente sin basecamp_project_id' };
  if (cliente.basecamp_project_id) {
    try {
      basecamp = await createProjectStructure(ctx, proyecto, requerimientos);
    } catch (err) {
      await updateProyecto(ctx, proyecto.id, { sync_estado: 'incompleto' });
      basecamp = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { proyecto, requerimientos, alertas: plan.alertas, basecamp };
}
