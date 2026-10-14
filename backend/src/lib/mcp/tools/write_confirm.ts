/**
 * ZONA DE REVISIÓN HUMANA (CLAUDE.md · lib/mcp/tools/*write*). confirm_plan: único punto que ejecuta un plan.
 */
import { z } from 'zod';
import { audit } from '../../db/audit';
import { crearProyectoDesdePlantilla } from '../../builder/service';
import { actualizarRequerimiento, ReglaError, type ResultadoBasecampDueOn } from '../../requerimientos/actualizar';
import { esColaborador } from '../../auth/roles';
import { tomarPlan, guardarResultado, verPlan } from '../plans';
import { publicarActaEnBasecamp } from '../publish';
import { getActa } from '../../db/semanas';
import type { CrearProyectoInput, ActualizarRequerimientoInput } from '@backio/shared';
import { type Herramientas, ok, fail, tiene } from '../comun';

export function registrarConfirmacion({ server, auth, ctx, guard }: Herramientas): void {
  server.registerTool(
    'confirm_plan',
    {
      description:
        'Ejecuta un plan generado por plan_project_from_template, plan_requirement_update o publish_document. El plan_id expira en 15 minutos y es de un solo uso.',
      inputSchema: { plan_id: z.string().regex(/^plan_[0-9a-f]{12}$/) },
    },
    ({ plan_id }) =>
      guard([], async () => {
        // Permisos ANTES de consumir: antes cualquier credencial del tenant que conociera el plan_id lo gastaba aunque
        // no pudiera ejecutarlo, y un plan de una API key podía confirmarlo otra (auditoría 10/10, S9).
        const visto = await verPlan(ctx, plan_id);
        if (!visto) return fail('plan_id no existe o no pertenece a este tenant');
        const scopeNecesario =
          visto.tool === 'plan_project_from_template'
            ? 'write:proyectos'
            : visto.tool === 'plan_requirement_update'
              ? 'write:requerimientos'
              : visto.tool === 'publish_document'
                ? 'write:actas'
                : null;
        if (!scopeNecesario) return fail(`Tool de plan desconocida: ${visto.tool}`);
        if (!tiene(auth, scopeNecesario)) return fail(`Scope requerido: ${scopeNecesario}`);
        if ((visto.api_key_id ?? null) !== (ctx.apiKeyId ?? null) || (visto.usuario_id ?? null) !== (ctx.usuarioId ?? null))
          return fail('Este plan lo generó otra credencial');
        const plan = await tomarPlan(ctx, plan_id);
        if (plan.tool === 'plan_project_from_template') {
          if (!tiene(auth, 'write:proyectos')) return fail('Scope requerido: write:proyectos');
          const r = await crearProyectoDesdePlantilla(ctx, plan.parametros as CrearProyectoInput);
          const salida = {
            proyecto_id: r.proyecto.id,
            nombre: r.proyecto.nombre,
            requerimientos_creados: r.requerimientos.length,
            basecamp: r.basecamp,
            portal_token: r.proyecto.portal_token,
          };
          await guardarResultado(ctx, plan_id, salida);
          await audit(ctx, { accion: 'mcp_confirm', entidad: 'proyecto', entidad_id: r.proyecto.id, detalle: { plan_id } });
          return ok(salida);
        }
        if (plan.tool === 'plan_requirement_update') {
          if (!tiene(auth, 'write:requerimientos')) return fail('Scope requerido: write:requerimientos');
          const { requerimiento_id, patch } = plan.parametros as { requerimiento_id: string; patch: ActualizarRequerimientoInput };
          let basecamp_due_on: ResultadoBasecampDueOn;
          try {
            ({ basecamp_due_on } = await actualizarRequerimiento(ctx, requerimiento_id, patch, {
              colaborador: esColaborador(auth),
              exigirMotivo: true,
              auditoriaExtra: { plan_id },
            }));
          } catch (e) {
            // El plan ya se consumió: la regla pudo cambiar entre el preview y la confirmación (p. ej. se vinculó a Basecamp).
            if (e instanceof ReglaError) return fail(e.message);
            throw e;
          }
          await guardarResultado(ctx, plan_id, { ok: true });
          return ok({ ok: true, requerimiento_id, aplicado: patch, basecamp_due_on });
        }
        if (plan.tool === 'publish_document') {
          if (!tiene(auth, 'write:actas')) return fail('Scope requerido: write:actas');
          const { acta_id } = plan.parametros as { acta_id: string };
          const acta = await getActa(ctx, acta_id);
          if (!acta) return fail('Acta no encontrada');
          if (acta.publicado_at) return fail('El acta ya fue publicada');
          // publicarActaEnBasecamp reserva el acta de forma atómica antes de llamar a Basecamp (S7).
          const r = await publicarActaEnBasecamp(ctx, acta);
          await guardarResultado(ctx, plan_id, r);
          await audit(ctx, { accion: 'publicar_acta', entidad: 'acta', entidad_id: acta.id, detalle: { ...r, plan_id } });
          return ok(r);
        }
        return fail(`Tool de plan desconocida: ${plan.tool}`);
      })(),
  );
}
