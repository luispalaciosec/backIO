import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import { ensureSemana, getSemana, listSenales, marcarSenalAtendida, insertAcuerdo, cerrarAcuerdo, listAcuerdosSemana, listAcuerdosAbiertos, getActa, audit } from '../../lib/db';
import { recalcularSenales, capacidadSemana, generarPlanOperativo, generarActaCierre } from '../../lib/rituals/service';
import { getDaily, fechaLocal } from '../../lib/rituals/daily';
import { publicarActaEnBasecamp, publicarDailyEnBasecamp, type DailyMensaje } from '../../lib/mcp/publish';
import { getMesa } from '../../lib/db';
import { armarDailyMensaje } from '../../lib/ia/daily';
import { narrarWeekly, renderWeeklyIA } from '../../lib/ia/weekly';

export const semanas = new Hono();

semanas.get('/actual', requireScope('read:senales'), async (c) => c.json(await ensureSemana(ctxOf(c), fechaLocal())));

semanas.get('/daily', requireScope('read:backlog'), async (c) => c.json(await getDaily(ctxOf(c))));

semanas.get('/acuerdos/abiertos', requireScope('read:senales'), async (c) => c.json({ items: await listAcuerdosAbiertos(ctxOf(c)) }));

semanas.get('/:id', requireScope('read:senales'), async (c) => {
  const s = await getSemana(ctxOf(c), c.req.param('id'));
  return s ? c.json(s) : c.json({ error: 'No encontrada' }, 404);
});

semanas.get('/:id/senales', requireScope('read:senales'), async (c) => {
  const items = await listSenales(ctxOf(c), c.req.param('id'));
  return c.json({ items, total: items.length });
});

semanas.post('/:id/senales/recalcular', requireScope('write:actas'), async (c) => {
  const items = await recalcularSenales(ctxOf(c), c.req.param('id'));
  return c.json({ items, total: items.length });
});

semanas.patch('/:id/senales/:senalId', requireScope('write:actas'), zValidator('json', z.object({ atendida: z.boolean() })), async (c) => {
  await marcarSenalAtendida(ctxOf(c), c.req.param('senalId'), c.req.valid('json').atendida);
  return c.body(null, 204);
});

semanas.get('/:id/capacidad', requireScope('read:capacidad'), async (c) => c.json({ items: await capacidadSemana(ctxOf(c), c.req.param('id')) }));

semanas.get('/:id/acuerdos', requireScope('read:senales'), async (c) => c.json({ items: await listAcuerdosSemana(ctxOf(c), c.req.param('id')) }));

// Tres campos: acuerdo, responsable, fecha. La fecha es un date picker real: sin "próxima weekly".
semanas.post(
  '/:id/acuerdos',
  requireScope('write:actas'),
  zValidator('json', z.object({ descripcion: z.string().min(3), responsable_id: z.string().uuid(), fecha_compromiso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })),
  async (c) => {
    const ctx = ctxOf(c);
    const a = await insertAcuerdo(ctx, { semana_id: c.req.param('id'), ...c.req.valid('json') });
    await audit(ctx, { accion: 'crear_acuerdo', entidad: 'acuerdo', entidad_id: a.id });
    return c.json(a, 201);
  },
);

semanas.post('/:id/acuerdos/:acuerdoId/cerrar', requireScope('write:actas'), zValidator('json', z.object({ estado: z.enum(['cumplido', 'cancelado']) })), async (c) => {
  await cerrarAcuerdo(ctxOf(c), c.req.param('acuerdoId'), c.req.valid('json').estado);
  return c.body(null, 204);
});

/** ?ia=1 antepone el resumen ejecutivo y la agenda por causa redactados por la IA. */
async function narrativaOpcional(c: Parameters<typeof ctxOf>[0], semanaId: string, mesaId: string | null): Promise<string | undefined> {
  if (c.req.query('ia') !== '1') return undefined;
  return renderWeeklyIA(await narrarWeekly(ctxOf(c), semanaId, mesaId));
}

semanas.post('/:id/plan', requireScope('write:actas'), async (c) => {
  const ctx = ctxOf(c);
  const mesaId = c.req.query('mesa') || null;
  const acta = await generarPlanOperativo(ctx, c.req.param('id'), mesaId, await narrativaOpcional(c, c.req.param('id'), mesaId));
  await audit(ctx, { accion: 'generar_plan_operativo', entidad: 'acta', entidad_id: acta.id });
  return c.json(acta, 201);
});

semanas.post('/:id/acta', requireScope('write:actas'), async (c) => {
  const ctx = ctxOf(c);
  const mesaId = c.req.query('mesa') || null;
  const acta = await generarActaCierre(ctx, c.req.param('id'), mesaId, await narrativaOpcional(c, c.req.param('id'), mesaId));
  await audit(ctx, { accion: 'generar_acta_cierre', entidad: 'acta', entidad_id: acta.id });
  return c.json(acta, 201);
});

semanas.get('/actas/:actaId', requireScope('read:senales'), async (c) => {
  const a = await getActa(ctxOf(c), c.req.param('actaId'));
  return a ? c.json(a) : c.json({ error: 'No encontrada' }, 404);
});

semanas.post('/actas/:actaId/publicar', requireScope('write:actas'), async (c) => {
  const ctx = ctxOf(c);
  const acta = await getActa(ctx, c.req.param('actaId'));
  if (!acta) return c.json({ error: 'No encontrada' }, 404);
  if (acta.publicado_at) return c.json({ error: 'Ya publicada' }, 409);
  try {
    const r = await publicarActaEnBasecamp(ctx, acta);
    await audit(ctx, { accion: 'publicar_acta', entidad: 'acta', entidad_id: acta.id, detalle: r });
    return c.json(r);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 422);
  }
});

/** Publica apertura o cierre de mesa en el board Daily, con las tres señales del daily acotadas a la mesa. */
semanas.post('/daily/publicar', requireScope('write:actas'), zValidator('json', z.object({
  mesa_id: z.string().uuid(), tipo: z.enum(['apertura', 'cierre']), notas: z.array(z.string()).default([]), responsable: z.string().optional(),
  narrativa: z.string().max(4000).optional(),
})), async (c) => {
  const ctx = ctxOf(c);
  const b = c.req.valid('json');
  const mesa = await getMesa(ctx, b.mesa_id);
  if (!mesa) return c.json({ error: 'Mesa no encontrada' }, 404);
  const m: DailyMensaje = { ...(await armarDailyMensaje(ctx, mesa, b.tipo, b.notas, b.responsable ?? c.get('auth').nombre)), narrativa: b.narrativa?.trim() || undefined };
  try {
    const r = await publicarDailyEnBasecamp(ctx, mesa, m);
    await audit(ctx, { accion: `publicar_daily_${b.tipo}`, entidad: 'mesa', entidad_id: mesa.id, detalle: { message_id: r.id } });
    return c.json({ ...r, resumen: { vencen: m.vencen.length, bloqueos: m.bloqueos.length, cambios: m.cambios.length } });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 422);
  }
});
