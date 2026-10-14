/**
 * ZONA DE REVISIÓN HUMANA (CLAUDE.md · lib/mcp/tools/*write*). Escrituras en dos pasos: estas tools devuelven un
 * plan (diff) y no ejecutan; confirm_plan lo aplica.
 */
import { z } from 'zod';
import { listPlantillas } from '../../db/plantillas';
import { listUsuarios } from '../../db/usuarios';
import { listTiposPieza } from '../../db/tipos_pieza';
import { audit } from '../../db/audit';
import { previewProyecto } from '../../builder/service';
import { getRequerimiento } from '../../db/requerimientos';
import { validarActualizacion, ReglaError } from '../../requerimientos/actualizar';
import { esColaborador } from '../../auth/roles';
import { guardarPlan } from '../plans';
import type { CrearProyectoInput, ActualizarRequerimientoInput } from '@backio/shared';
import { type Herramientas, ok, fail, resolverCliente, resolverPersona } from '../comun';

export function registrarPlanes({ server, auth, ctx, guard }: Herramientas): void {
  server.registerTool(
    'plan_project_from_template',
    {
      description:
        'Devuelve un PLAN para crear un proyecto desde plantilla (requerimientos, fechas, pesos, vista cliente, advertencias). NO ejecuta. Para ejecutar, llamar confirm_plan con el plan_id dentro de 15 minutos.',
      inputSchema: {
        plantilla: z.string().describe('id o nombre de la plantilla'),
        cliente: z.string().describe('id, slug o nombre del cliente'),
        nombre: z.string().min(3),
        fecha_entrega: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        brief: z.object({
          objetivo_negocio: z.string(),
          publico_objetivo: z.string(),
          canales: z.array(z.string()).min(1),
          mandatorios_marca: z.string().optional(),
        }),
        bloques: z
          .array(
            z.object({
              bloque_id: z.string().uuid(),
              activo: z.boolean().default(true),
              owner: z.string().nullable().optional().describe('nombre o id'),
              piezas_por_canal: z.record(z.number().int().min(0)).default({}),
              piezas: z
                .record(z.number().int().min(0))
                .default({})
                .describe('cantidades por tipo de pieza: {"reel": 4, "post": 8, "carrusel": 2}'),
            }),
          )
          .default([]),
      },
    },
    (args) =>
      guard(['write:proyectos'], async () => {
        const c = await resolverCliente(ctx, args.cliente);
        if (!c) return fail(`Cliente "${args.cliente}" no encontrado`);
        const plantillas = await listPlantillas(ctx);
        const pl =
          plantillas.find((p) => p.id === args.plantilla) ??
          plantillas.find((p) => p.nombre.toLowerCase().includes(args.plantilla.toLowerCase()));
        if (!pl) return fail(`Plantilla "${args.plantilla}" no encontrada. Disponibles: ${plantillas.map((p) => p.nombre).join(', ')}`);
        const [usuarios, tipos] = await Promise.all([listUsuarios(ctx), listTiposPieza(ctx)]);
        const errores: string[] = [];
        const ownerDe = (ref: string): string | null => {
          const r = resolverPersona(usuarios, ref);
          if ('error' in r) errores.push(r.error);
          return 'id' in r ? r.id : null;
        };
        const tipoId = (k: string) =>
          tipos.find((t) => t.slug === k.toLowerCase() || t.nombre.toLowerCase() === k.toLowerCase() || t.id === k)?.id;
        const input: CrearProyectoInput = {
          cliente_id: c.id,
          plantilla_id: pl.id,
          nombre: args.nombre,
          fecha_entrega: args.fecha_entrega,
          brief: args.brief,
          bloques: args.bloques.map((b) => ({
            bloque_id: b.bloque_id,
            activo: b.activo,
            piezas_por_canal: b.piezas_por_canal,
            piezas_por_tipo: Object.fromEntries(
              Object.entries(b.piezas)
                .map(([k, v]) => [tipoId(k) ?? k, v])
                .filter(([k]) => tipos.some((t) => t.id === k)),
            ),
            owner_id: b.owner ? ownerDe(b.owner) : null,
          })),
        };
        if (errores.length) return fail(errores.join(' · '));
        const preview = await previewProyecto(ctx, input);
        const { plan_id, expira_en } = await guardarPlan(ctx, 'plan_project_from_template', input, preview.resumen);
        await audit(ctx, {
          accion: 'mcp_plan',
          entidad: 'proyecto',
          detalle: { tool: 'plan_project_from_template', plan_id, resumen: preview.resumen },
        });
        return ok({
          plan_id,
          expira_en,
          resumen: `Crear proyecto "${args.nombre}" para ${c.nombre} con plantilla ${pl.nombre}`,
          cambios: {
            proyectos_a_crear: 1,
            requerimientos_a_crear: preview.resumen.requerimientos_a_crear,
            todos_basecamp_a_crear: preview.resumen.todos_basecamp_a_crear,
            visibles_al_cliente: preview.resumen.visibles_al_cliente,
          },
          detalle: preview.plan.tareas.map((t) => ({
            bloque: t.bloque_nombre,
            titulo: t.titulo_interno,
            etiqueta_cliente: t.etiqueta_cliente,
            visible: t.visible_cliente,
            peso: t.peso,
            fecha_entrega: t.fecha_entrega,
            owners: t.owner_agencia.map((id) => usuarios.find((u) => u.id === id)?.nombre ?? id),
          })),
          vista_cliente: preview.vista_cliente,
          advertencias: preview.alertas.map(
            (a) => `${a.nombre} quedaría con ${a.tareas} de ${a.total} tareas en la semana del ${a.semana_inicio} (${a.pct}%)`,
          ),
          siguiente_paso: 'Si el plan es correcto, llama confirm_plan con este plan_id.',
        });
      })(),
  );

  server.registerTool(
    'plan_requirement_update',
    {
      description:
        'Devuelve el DIFF de una actualización de requerimiento (estado, prioridad, fecha, aprobación, owners). NO aplica. Confirmar con confirm_plan.',
      inputSchema: {
        requerimiento_id: z.string().uuid(),
        cambios: z.object({
          estado_operativo: z
            .enum(['backlog', 'priorizado', 'en_ejecucion', 'en_revision', 'reprogramado', 'bloqueado', 'cancelado'])
            .optional(),
          estado_aprobacion: z.enum(['no_aplica', 'pendiente_interno', 'pendiente_cliente', 'aprobado', 'rechazado']).optional(),
          prioridad: z.enum(['alta', 'media', 'baja']).optional(),
          fecha_entrega: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          motivo_reprogramacion: z
            .enum(['insumos_cliente', 'cambio_alcance', 'capacidad_equipo', 'prioridad_negocio', 'error_estimacion', 'reproceso', 'otro'])
            .optional()
            .describe('Obligatorio si cambia fecha_entrega: causa de la reprogramación'),
          owners: z.array(z.string()).optional().describe('nombres o ids'),
          piezas: z.number().int().min(0).optional(),
        }),
      },
    },
    ({ requerimiento_id, cambios }) =>
      guard(['write:requerimientos'], async () => {
        const r = await getRequerimiento(ctx, requerimiento_id);
        if (!r) return fail('Requerimiento no encontrado');
        const usuarios = await listUsuarios(ctx);
        const patch: ActualizarRequerimientoInput = {};
        if (cambios.estado_operativo) patch.estado_operativo = cambios.estado_operativo;
        if (cambios.estado_aprobacion) patch.estado_aprobacion = cambios.estado_aprobacion;
        if (cambios.prioridad) patch.prioridad = cambios.prioridad;
        if (cambios.fecha_entrega) patch.fecha_entrega = cambios.fecha_entrega;
        if (cambios.fecha_entrega && cambios.fecha_entrega !== r.fecha_entrega && !cambios.motivo_reprogramacion)
          return fail(
            'Cambiar fecha_entrega requiere motivo_reprogramacion (insumos_cliente, cambio_alcance, capacidad_equipo, prioridad_negocio, error_estimacion, reproceso, otro)',
          );
        if (cambios.motivo_reprogramacion) patch.motivo_reprogramacion = cambios.motivo_reprogramacion;
        if (cambios.piezas !== undefined) patch.piezas = cambios.piezas;
        if (cambios.owners) {
          // Antes se descartaba en silencio a quien no se encontraba: el plan quitaba responsables sin decirlo.
          const r = cambios.owners.map((o) => resolverPersona(usuarios, o));
          const errores = r.flatMap((x) => ('error' in x ? [x.error] : []));
          if (errores.length) return fail(errores.join(' · '));
          patch.owner_agencia = [...new Set(r.flatMap((x) => ('id' in x ? [x.id] : [])))];
        }
        const diff = Object.entries(patch)
          .filter(([k]) => k !== 'motivo_reprogramacion')
          .map(([k, v]) => ({ campo: k, antes: (r as unknown as Record<string, unknown>)[k], despues: v }));
        if (diff.length === 0) return fail('Sin cambios que aplicar');
        // Mismas reglas que la UI, ya en el preview: un plan que no se podrá aplicar no se ofrece (B9).
        try {
          validarActualizacion(ctx, r, patch, { colaborador: esColaborador(auth), exigirMotivo: true });
        } catch (e) {
          if (e instanceof ReglaError) return fail(e.message);
          throw e;
        }
        const { plan_id, expira_en } = await guardarPlan(ctx, 'plan_requirement_update', { requerimiento_id, patch }, diff);
        return ok({
          plan_id,
          expira_en,
          requerimiento: r.titulo_interno,
          diff,
          nota: patch.fecha_entrega ? 'Cambiar fecha_entrega cuenta como reprogramación y se refleja en Basecamp (due_on).' : undefined,
          siguiente_paso: 'Confirmar con confirm_plan.',
        });
      })(),
  );
}
