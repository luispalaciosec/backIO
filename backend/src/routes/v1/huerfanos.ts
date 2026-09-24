import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import { detectarHuerfanos, listHuerfanos, adoptarHuerfano, ignorarHuerfano } from '../../lib/basecamp/huerfanos';
import { audit } from '../../lib/db/audit';
import { serviceClient } from '../../lib/db/client';

export const huerfanos = new Hono();

huerfanos.get('/', requireScope('read:backlog'), async (c) => c.json({ items: await listHuerfanos(ctxOf(c), c.req.query('todos') !== '1') }));
huerfanos.post('/detectar', requireScope('write:requerimientos'), async (c) => {
  try { return c.json(await detectarHuerfanos(ctxOf(c))); } catch (err) { return c.json({ error: err instanceof Error ? err.message : String(err) }, 422); }
});
huerfanos.post('/:id/adoptar', requireScope('write:requerimientos'), zValidator('json', z.object({ proyecto_id: z.string().uuid().nullable().optional() })), async (c) => {
  try { return c.json(await adoptarHuerfano(ctxOf(c), c.req.param('id'), c.req.valid('json').proyecto_id ?? null)); } catch (err) { return c.json({ error: err instanceof Error ? err.message : String(err) }, 422); }
});
/**
 * Bandeja «Entradas desde Basecamp»: requerimientos que entraron solos desde Basecamp (audit basecamp_entrada)
 * en los últimos N días y que ninguna ejecutiva marcó como revisados (audit revisar_entrada).
 */
huerfanos.get('/entradas', requireScope('read:backlog'), async (c) => {
  const ctx = ctxOf(c);
  const dias = Number(c.req.query('dias') ?? 14);
  const desde = new Date(Date.now() - (Number.isFinite(dias) ? dias : 14) * 86_400_000).toISOString();
  // audit_log no tiene política de lectura para usuarios: se lee con service role, acotado al tenant.
  const svc = serviceClient();
  const { data: ent } = await svc.from('audit_log').select('entidad_id, created_at, detalle').eq('tenant_id', ctx.tenantId).eq('accion', 'basecamp_entrada').gte('created_at', desde).order('created_at', { ascending: false }).limit(500);
  type E = { entidad_id: string; created_at: string; detalle: Record<string, unknown> };
  const entradas = (ent ?? []) as E[];
  if (!entradas.length) return c.json({ items: [] });
  const ids = entradas.map((e) => e.entidad_id);
  const [{ data: rev }, { data: reqs }] = await Promise.all([
    svc.from('audit_log').select('entidad_id').eq('tenant_id', ctx.tenantId).eq('accion', 'revisar_entrada').in('entidad_id', ids),
    ctx.db.from('v_requerimientos_metricas').select('id, titulo_interno, cliente_id, proyecto_id, bloque_nombre, owner_agencia, fecha_entrega, estado_operativo, prioridad, tipo_trabajo, piezas, estado_aprobacion, basecamp_url, planificacion').eq('tenant_id', ctx.tenantId).in('id', ids),
  ]);
  const revisadas = new Set(((rev ?? []) as { entidad_id: string }[]).map((r) => r.entidad_id));
  const porId = new Map(((reqs ?? []) as { id: string }[]).map((r) => [r.id, r]));
  const items = entradas.filter((e) => !revisadas.has(e.entidad_id) && porId.has(e.entidad_id)).map((e) => ({ ...(porId.get(e.entidad_id) as object), entrada_at: e.created_at, lista: e.detalle.lista ?? null, creador: e.detalle.creador ?? null }));
  return c.json({ items });
});
huerfanos.post('/entradas/:id/revisada', requireScope('write:requerimientos'), async (c) => {
  const ctx = ctxOf(c);
  await audit(ctx, { accion: 'revisar_entrada', entidad: 'requerimiento', entidad_id: c.req.param('id'), detalle: {} });
  return c.body(null, 204);
});
huerfanos.post('/:id/ignorar', requireScope('write:requerimientos'), async (c) => { await ignorarHuerfano(ctxOf(c), c.req.param('id')); return c.body(null, 204); });
