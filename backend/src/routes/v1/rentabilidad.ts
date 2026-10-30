import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { hoyLocal } from '@backio/shared';
import { zValidator } from '../../lib/validacion';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import { esGerenciaOAdmin } from '../../lib/auth/roles';
import { rentabilidadMes } from '../../lib/rentabilidad';
import { guardarCostoPersonal, guardarFeeCliente, listCostosPersonal, listFeesCliente } from '../../lib/db/costos';
import { clienteEsDelTenant, usuarioDelTenant } from '../../lib/db/admin';
import { audit } from '../../lib/db/audit';

/**
 * Rentabilidad, sueldos y fees (docs/21, migración 41). Solo gerencia y admin con sesión de la UI: cada ruta lo valida
 * y además la RLS de las tablas lo exige. La auditoría registra quién cambió qué, nunca los montos.
 */
export const rentabilidad = new Hono();

const SOLO_GERENCIA = { error: 'La rentabilidad, los sueldos y los fees son solo para gerencia y admin' };
const prohibido = (c: Context) => !esGerenciaOAdmin(c.get('auth'));

const mesValido = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .optional();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const sumarMeses = (mes: string, n: number) => {
  const [a, m] = mes.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

/** Rentabilidad del mes por cliente (por defecto, el mes en curso). */
rentabilidad.get('/rentabilidad', requireScope('read:proyectos'), zValidator('query', z.object({ mes: mesValido })), async (c) => {
  if (prohibido(c)) return c.json(SOLO_GERENCIA, 403);
  return c.json(await rentabilidadMes(ctxOf(c), c.req.valid('query').mes ?? hoyLocal().slice(0, 7)));
});

/** Un cliente en los últimos 6 meses (para su ficha). */
rentabilidad.get('/rentabilidad/clientes/:id', requireScope('read:proyectos'), async (c) => {
  if (prohibido(c)) return c.json(SOLO_GERENCIA, 403);
  const ctx = ctxOf(c);
  const id = c.req.param('id');
  const actual = hoyLocal().slice(0, 7);
  const meses = Array.from({ length: 6 }, (_, i) => sumarMeses(actual, i - 5));
  const items = await Promise.all(
    meses.map(async (mes) => {
      const r = await rentabilidadMes(ctx, mes);
      const x = r.clientes.find((y) => y.cliente_id === id);
      return {
        mes,
        fee: x?.fee ?? null,
        costo: x?.costo ?? 0,
        margen: x?.margen ?? null,
        margen_pct: x?.margen_pct ?? null,
        horas: x?.horas ?? 0,
        personas: x?.personas ?? [],
      };
    }),
  );
  return c.json({ items });
});

rentabilidad.get('/costos', requireScope('read:proyectos'), async (c) => {
  if (prohibido(c)) return c.json(SOLO_GERENCIA, 403);
  const ctx = ctxOf(c);
  const [sueldos, fees] = await Promise.all([listCostosPersonal(ctx), listFeesCliente(ctx)]);
  return c.json({ sueldos, fees });
});

rentabilidad.put(
  '/costos/sueldos',
  requireScope('write:proyectos'),
  zValidator('json', z.object({ usuario_id: z.string().uuid(), sueldo_mensual: z.number().positive().max(1_000_000), desde: fecha })),
  async (c) => {
    if (prohibido(c)) return c.json(SOLO_GERENCIA, 403);
    const ctx = ctxOf(c);
    const x = c.req.valid('json');
    if (!(await usuarioDelTenant(ctx, x.usuario_id))) return c.json({ error: 'Persona no encontrada' }, 404);
    await guardarCostoPersonal(ctx, x);
    await audit(ctx, { accion: 'sueldo_guardado', entidad: 'usuario', entidad_id: x.usuario_id, detalle: { desde: x.desde } });
    return c.json({ ok: true });
  },
);

rentabilidad.put(
  '/costos/fees',
  requireScope('write:proyectos'),
  zValidator('json', z.object({ cliente_id: z.string().uuid(), fee_mensual: z.number().min(0).max(10_000_000), desde: fecha })),
  async (c) => {
    if (prohibido(c)) return c.json(SOLO_GERENCIA, 403);
    const ctx = ctxOf(c);
    const x = c.req.valid('json');
    if (!(await clienteEsDelTenant(ctx, x.cliente_id))) return c.json({ error: 'Cliente no encontrado' }, 404);
    await guardarFeeCliente(ctx, x);
    await audit(ctx, { accion: 'fee_guardado', entidad: 'cliente', entidad_id: x.cliente_id, detalle: { desde: x.desde } });
    return c.json({ ok: true });
  },
);
