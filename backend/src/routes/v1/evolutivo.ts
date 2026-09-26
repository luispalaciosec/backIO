/** Evolutivo de rituales por mesa y mes (docs/05-rituales.md «Evolutivo»). Ver: gestión. Reconstruir: admin. */
import { Hono, type MiddlewareHandler } from 'hono';
import { ROLES_INTERNOS_GESTION } from '@backio/shared';
import { ctxOf, requireScope } from '../../lib/auth/middleware';
import { getMesa, listMesas } from '../../lib/db/mesas';
import { audit } from '../../lib/db/audit';
import { evolutivoMes, reconstruirDesde } from '../../lib/evolutivo';

export const evolutivo = new Hono();

const soloGestion: MiddlewareHandler = async (c, next) => {
  const a = c.get('auth');
  if (a.tipo === 'usuario' && a.perfil !== 'oauth') return a.rol && ROLES_INTERNOS_GESTION.includes(a.rol) ? next() : c.json({ error: 'Sin acceso' }, 403);
  return requireScope('read:backlog')(c, next);
};
const mesValido = (m?: string) => (m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 7));
const errorMigracion = (e: unknown) => { const m = e instanceof Error ? e.message : String(e); return /daily_snapshots|weekly_snapshots|schema cache|does not exist/i.test(m) ? 'Falta aplicar la migración 23 (evolutivo) en Supabase.' : m; };

evolutivo.get('/', soloGestion, async (c) => {
  const ctx = ctxOf(c);
  const mesas = (await listMesas(ctx)).filter((m) => m.activa);
  const mesa = mesas.find((m) => m.id === c.req.query('mesa')) ?? mesas[0];
  if (!mesa) return c.json({ error: 'No hay mesas activas' }, 404);
  try { return c.json({ ...(await evolutivoMes(ctx, mesa, mesValido(c.req.query('mes')))), mesas: mesas.map((m) => ({ id: m.id, nombre: m.nombre })) }); }
  catch (e) { return c.json({ error: errorMigracion(e) }, 422); }
});

evolutivo.get('/export', soloGestion, async (c) => {
  const ctx = ctxOf(c);
  const mesa = await getMesa(ctx, c.req.query('mesa') ?? '');
  if (!mesa) return c.json({ error: 'Mesa no encontrada' }, 404);
  const e = await evolutivoMes(ctx, mesa, mesValido(c.req.query('mes')));
  const cols = ['planificadas', 'cerradas_planificadas', 'cumplimiento_pct', 'cerradas_fuera', 'cerradas_total', 'nuevas_hoy', 'nuevas_no_planificadas', 'nuevas_urgentes', 'reprocesos_hoy', 'reprogramaciones_24h', 'bloqueos_nuevos', 'vencidas_abiertas'] as const;
  const filas = [['fecha', ...cols, 'cierre_publicado', 'origen'].join(','), ...e.dias.map((d) => [d.fecha, ...cols.map((k) => d.metricas[k] ?? ''), d.publicado ? 'si' : 'no', d.origen].join(','))];
  return c.body(`﻿${filas.join('\n')}`, 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="evolutivo-${mesa.slug ?? mesa.id}-${e.mes}.csv"` });
});

/** Rehace días y semanas desde una fecha (por defecto 21/09/2026, desde cuando la auditoría es confiable). */
evolutivo.post('/reconstruir', requireScope('admin'), async (c) => {
  const ctx = ctxOf(c);
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(c.req.query('desde') ?? '') ? c.req.query('desde')! : '2026-09-21';
  try {
    const r = await reconstruirDesde(ctx, desde);
    await audit(ctx, { accion: 'evolutivo_reconstruir', entidad: 'tenant', entidad_id: ctx.tenantId, detalle: { desde, ...r } });
    return c.json(r);
  } catch (e) { return c.json({ error: errorMigracion(e) }, 422); }
});
