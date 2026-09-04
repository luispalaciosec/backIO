import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import { listRecurrencias, getRecurrencia, upsertRecurrencia, updateRecurrencia, recurrenciaDesdeProyecto, generarPeriodo, procesarRecurrencias, periodoSiguiente, nombreDelPeriodo } from '../../lib/recurrencias';
import { fechaLocal } from '../../lib/rituals/daily';

/** Recurrencia mensual de fees (D2). */
export const recurrencias = new Hono();

recurrencias.get('/', requireScope('read:proyectos'), async (c) => {
  const ctx = ctxOf(c);
  const items = await listRecurrencias(ctx);
  const siguiente = periodoSiguiente(fechaLocal().slice(0, 7));
  return c.json({ items: items.map((r) => ({ ...r, proximo_periodo: siguiente, proximo_nombre: nombreDelPeriodo(r.nombre_patron, siguiente), pendiente: r.activa && (!r.ultimo_mes_generado || r.ultimo_mes_generado < siguiente) })) });
});

recurrencias.post('/', requireScope('write:proyectos'), zValidator('json', z.object({
  cliente_id: z.string().uuid(), plantilla_id: z.string().uuid(), nombre_patron: z.string().min(3),
  brief: z.record(z.unknown()).default({}), bloques: z.array(z.record(z.unknown())).default([]),
  owner_ejecutiva: z.string().uuid().nullable().optional(), dia_generacion: z.number().int().min(1).max(28).optional(),
  proyecto_origen_id: z.string().uuid().nullable().optional(), ultimo_mes_generado: z.string().regex(/^\d{4}-\d{2}$/).nullable().optional(), ultimo_proyecto_id: z.string().uuid().nullable().optional(),
})), async (c) => {
  const b = c.req.valid('json');
  const r = await upsertRecurrencia(ctxOf(c), { ...b, bloques: b.bloques as never, owner_ejecutiva: b.owner_ejecutiva ?? null });
  return c.json(r, 201);
});

recurrencias.post('/desde-proyecto/:proyectoId', requireScope('write:proyectos'), zValidator('json', z.object({ dia_generacion: z.number().int().min(1).max(28).optional() }).optional()), async (c) => {
  const r = await recurrenciaDesdeProyecto(ctxOf(c), c.req.param('proyectoId'), c.req.valid('json')?.dia_generacion ?? 25);
  return c.json(r, 201);
});

recurrencias.patch('/:id', requireScope('write:proyectos'), zValidator('json', z.object({
  activa: z.boolean().optional(), dia_generacion: z.number().int().min(1).max(28).optional(), nombre_patron: z.string().min(3).optional(), owner_ejecutiva: z.string().uuid().nullable().optional(),
})), async (c) => c.json(await updateRecurrencia(ctxOf(c), c.req.param('id'), c.req.valid('json'))));

/** Generar ahora el periodo indicado (por defecto el mes siguiente). Idempotente por periodo. */
recurrencias.post('/:id/generar', requireScope('write:proyectos'), zValidator('json', z.object({ periodo: z.string().regex(/^\d{4}-\d{2}$/).optional() }).optional()), async (c) => {
  const ctx = ctxOf(c);
  const rec = await getRecurrencia(ctx, c.req.param('id'));
  if (!rec) return c.json({ error: 'Recurrencia no encontrada' }, 404);
  const periodo = c.req.valid('json')?.periodo ?? periodoSiguiente(fechaLocal().slice(0, 7));
  return c.json(await generarPeriodo(ctx, rec, periodo), 201);
});

recurrencias.post('/procesar', requireScope('admin'), async (c) => c.json(await procesarRecurrencias(ctxOf(c))));
