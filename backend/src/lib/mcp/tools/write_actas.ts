/**
 * ZONA DE REVISIÓN HUMANA (CLAUDE.md · lib/mcp/tools/*write*). Generar actas (borradores internos, no publica) y
 * pedir su publicación en Basecamp: publish_document devuelve un plan y publica recién con confirm_plan (regla 4;
 * escaneo del 13/10/2026, aprobado por Luis). Antes publicaba en una sola llamada.
 */
import { z } from 'zod';
import { resolverMesa, listMesas } from '../../db/mesas';
import { ensureSemana, getSemana, getActa } from '../../db/semanas';
import { audit } from '../../db/audit';
import { generarPlanOperativo, generarActaCierre } from '../../rituals/service';
import { guardarPlan } from '../plans';
import { hoyLocal } from '@backio/shared';
import { type Herramientas, ok, fail } from '../comun';

/** Las dos actas del weekly se generan igual: cambia la función que redacta y la acción auditada. */
const GENERADORES = [
  {
    tool: 'generate_weekly_plan',
    descripcion: 'Genera el Plan Operativo Semanal (markdown en el formato de Geeks). No publica.',
    generar: generarPlanOperativo,
    accion: 'generar_plan_operativo',
  },
  {
    tool: 'generate_closing_minutes',
    descripcion: 'Genera el Acta de Cierre de la semana (markdown). No publica.',
    generar: generarActaCierre,
    accion: 'generar_acta_cierre',
  },
] as const;

export function registrarActas({ server, ctx, guard }: Herramientas): void {
  for (const g of GENERADORES) {
    server.registerTool(
      g.tool,
      {
        description: g.descripcion,
        inputSchema: {
          semana_id: z.string().uuid().optional(),
          mesa: z.string().describe('Mesa (Orión, Omega): el acta se publica en su proyecto Basecamp'),
        },
      },
      ({ semana_id, mesa }) =>
        guard(['write:actas'], async () => {
          const semana = semana_id ? await getSemana(ctx, semana_id) : await ensureSemana(ctx, hoyLocal());
          if (!semana) return fail('Semana no encontrada');
          const m = await resolverMesa(ctx, mesa);
          if (!m) return fail(`Mesa "${mesa}" no encontrada. Disponibles: ${(await listMesas(ctx)).map((x) => x.nombre).join(', ')}`);
          const acta = await g.generar(ctx, semana.id, m.id);
          await audit(ctx, { accion: g.accion, entidad: 'acta', entidad_id: acta.id });
          return ok({
            acta_id: acta.id,
            tipo: acta.tipo,
            markdown: acta.markdown,
            siguiente_paso: 'Revisar y, si procede, publish_document con acta_id (devuelve un plan para confirm_plan).',
          });
        })(),
    );
  }

  server.registerTool(
    'publish_document',
    {
      description:
        'Devuelve un PLAN para publicar un acta generada en el board de su mesa en Basecamp (lo ve el equipo). NO publica. Para publicar, llamar confirm_plan con el plan_id dentro de 15 minutos.',
      inputSchema: { acta_id: z.string().uuid() },
    },
    ({ acta_id }) =>
      guard(['write:actas'], async () => {
        const acta = await getActa(ctx, acta_id);
        if (!acta) return fail('Acta no encontrada');
        if (acta.publicado_at) return fail('El acta ya fue publicada');
        const mesa = acta.mesa_id ? (await listMesas(ctx)).find((m) => m.id === acta.mesa_id) : undefined;
        const resumen = {
          acta_id: acta.id,
          tipo: acta.tipo,
          mesa: mesa?.nombre ?? null,
          destino: 'Board de la mesa en Basecamp (lo lee el equipo; avisa a los suscriptores)',
          inicio: acta.markdown.slice(0, 400),
        };
        const { plan_id, expira_en } = await guardarPlan(ctx, 'publish_document', { acta_id: acta.id }, resumen);
        await audit(ctx, { accion: 'mcp_plan', entidad: 'acta', entidad_id: acta.id, detalle: { tool: 'publish_document', plan_id } });
        return ok({ plan_id, expira_en, publicaria: resumen, siguiente_paso: 'Si es correcto, llama confirm_plan con este plan_id.' });
      })(),
  );
}
