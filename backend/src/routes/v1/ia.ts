import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import { audit } from '../../lib/db/audit';
import { getMesa } from '../../lib/db/mesas';
import { iaDisponible, MODELO_IA } from '../../lib/ia';
import { armarDailyMensaje, narrarDaily, DailySinResponsable } from '../../lib/ia/daily';
import { narrarWeekly } from '../../lib/ia/weekly';
import { briefDesdeTexto } from '../../lib/ia/brief';
import { redactarRecordatorio } from '../../lib/ia/recordatorio';
import { generarInformeMensual } from '../../lib/ia/informe';
import { informeCanal, gruposInforme } from '../../lib/informe_canal';
import { fechaLocal } from '../../lib/rituals/daily';

/** Capa de IA: redacta, nunca publica. Todo lo que sale de aquí lo revisa y publica una persona. */
export const ia = new Hono();

ia.get('/estado', requireScope('read:backlog'), (c) => c.json({ disponible: iaDisponible(), modelo: MODELO_IA }));

ia.post('/daily', requireScope('write:actas'), zValidator('json', z.object({ mesa_id: z.string().uuid(), tipo: z.enum(['apertura', 'cierre']), notas: z.array(z.string()).default([]) })), async (c) => {
  const ctx = ctxOf(c); const b = c.req.valid('json');
  const mesa = await getMesa(ctx, b.mesa_id);
  if (!mesa) return c.json({ error: 'Mesa no encontrada' }, 404);
  let m;
  try { m = await armarDailyMensaje(ctx, mesa, b.tipo, b.notas, c.get('auth').nombre); }
  catch (err) { if (err instanceof DailySinResponsable) return c.json({ error: err.message, tareas: err.tareas }, 422); throw err; }
  const texto = await narrarDaily(ctx, mesa, m);
  return c.json({ texto, resumen: { hoy: m.hoy.length, vencen: m.vencen.length, bloqueos: m.bloqueos.length, cambios: m.cambios.length, completadas: (m.completadas?.length ?? 0) + (m.completadas_fuera?.length ?? 0) } });
});

ia.post('/weekly', requireScope('write:actas'), zValidator('json', z.object({ semana_id: z.string().uuid(), mesa_id: z.string().uuid().nullable().optional() })), async (c) => {
  const ctx = ctxOf(c); const b = c.req.valid('json');
  return c.json(await narrarWeekly(ctx, b.semana_id, b.mesa_id ?? null));
});

ia.post('/brief', requireScope('write:proyectos'), zValidator('json', z.object({ texto: z.string().min(20).max(20_000), cliente_id: z.string().uuid().nullable().optional() })), async (c) => {
  const ctx = ctxOf(c); const b = c.req.valid('json');
  const out = await briefDesdeTexto(ctx, b.texto, b.cliente_id ?? null);
  await audit(ctx, { accion: 'ia_brief', entidad: 'proyecto', entidad_id: null, detalle: { plantilla_sugerida_id: out.plantilla_sugerida_id, canales: out.canales } });
  return c.json(out);
});

ia.post('/recordatorio/:requerimientoId', requireScope('write:requerimientos'), async (c) => {
  const ctx = ctxOf(c);
  const out = await redactarRecordatorio(ctx, c.req.param('requerimientoId'), c.get('auth').nombre);
  await audit(ctx, { accion: 'ia_recordatorio', entidad: 'requerimiento', entidad_id: c.req.param('requerimientoId') });
  return c.json(out);
});

ia.post('/informe-mensual', requireScope('write:actas'), zValidator('json', z.object({ mesa_id: z.string().uuid(), mes: z.string().regex(/^\d{4}-\d{2}$/) })), async (c) => {
  const ctx = ctxOf(c); const b = c.req.valid('json');
  const acta = await generarInformeMensual(ctx, b.mesa_id, b.mes);
  await audit(ctx, { accion: 'generar_informe_mensual', entidad: 'acta', entidad_id: acta.id, detalle: { mesa_id: b.mesa_id, mes: b.mes } });
  return c.json(acta, 201);
});

ia.get('/informes', requireScope('read:senales'), async (c) => {
  const ctx = ctxOf(c);
  const { data } = await ctx.db.from('actas').select('id, tipo, mesa_id, semana_id, markdown, publicado_at, created_at').eq('tenant_id', ctx.tenantId).eq('tipo', 'informe_mensual').order('created_at', { ascending: false }).limit(24);
  return c.json({ items: data ?? [] });
});

// ---------------- Informe por canal (sin IA: puro cálculo)
ia.get('/canal/grupos', requireScope('read:senales'), async (c) => c.json({ items: await gruposInforme(ctxOf(c)) }));
ia.get('/canal', requireScope('read:senales'), async (c) => {
  const ctx = ctxOf(c);
  const ids = (c.req.query('clientes') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!ids.length) return c.json({ error: 'Indica clientes=id1,id2' }, 400);
  const hoy = fechaLocal();
  const desde = c.req.query('desde') ?? '2026-09-01';
  const hasta = c.req.query('hasta') ?? hoy;
  return c.json(await informeCanal(ctx, { clienteIds: ids, desde, hasta, titulo: c.req.query('titulo') || undefined }));
});
