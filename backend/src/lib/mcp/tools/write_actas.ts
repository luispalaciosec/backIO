/**
 * ZONA DE REVISIÓN HUMANA (CLAUDE.md · lib/mcp/tools/*write*). Generar actas (no publica) y publicarlas en Basecamp.
 */
import { z } from 'zod';
import { resolverMesa, listMesas } from '../../db/mesas';
import { ensureSemana, getSemana, getActa } from '../../db/semanas';
import { audit } from '../../db/audit';
import { generarPlanOperativo, generarActaCierre } from '../../rituals/service';
import { publicarActaEnBasecamp } from '../publish';
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
            siguiente_paso: 'Revisar y, si procede, publish_document con acta_id.',
          });
        })(),
    );
  }

  server.registerTool(
    'publish_document',
    {
      description:
        'Publica un acta generada como Documento en el proyecto Basecamp de operaciones del tenant. Requiere que el acta exista y no haya sido publicada.',
      inputSchema: { acta_id: z.string().uuid() },
    },
    ({ acta_id }) =>
      guard(['write:actas'], async () => {
        const acta = await getActa(ctx, acta_id);
        if (!acta) return fail('Acta no encontrada');
        if (acta.publicado_at) return fail('El acta ya fue publicada');
        const r = await publicarActaEnBasecamp(ctx, acta);
        await audit(ctx, { accion: 'publicar_acta', entidad: 'acta', entidad_id: acta.id, detalle: r });
        return ok(r);
      })(),
  );
}
