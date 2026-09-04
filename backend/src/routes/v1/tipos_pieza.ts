import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import { listTiposPieza, upsertTipoPieza, audit, slugify } from '../../lib/db';

export const tiposPieza = new Hono();

tiposPieza.get('/', requireScope('read:proyectos'), async (c) => c.json({ items: await listTiposPieza(ctxOf(c), c.req.query('todos') === '1') }));

const paso = z.object({
  titulo: z.string().min(1), rol: z.string().nullable().optional(), dias_offset: z.number().int().min(-60).max(365),
  peso: z.number().min(0), visible: z.boolean().default(false), etiqueta: z.string().nullable().optional(), aprobacion_cliente: z.boolean().default(false),
}).refine((p) => !p.visible || !!(p.etiqueta ?? p.titulo), { message: 'Paso visible requiere etiqueta' });

tiposPieza.put('/:slug', requireScope('write:proyectos'), zValidator('json', z.object({
  nombre: z.string().min(2), esfuerzo: z.number().min(0.1).max(50), pasos: z.array(paso).min(1), activo: z.boolean().default(true),
})), async (c) => {
  const ctx = ctxOf(c);
  const b = c.req.valid('json');
  const t = await upsertTipoPieza(ctx, { ...b, slug: c.req.param('slug') === 'nuevo' ? slugify(b.nombre) : c.req.param('slug') });
  await audit(ctx, { accion: 'guardar_tipo_pieza', entidad: 'tipo_pieza', entidad_id: t.id, detalle: { pasos: b.pasos.length, esfuerzo: b.esfuerzo } });
  return c.json(t);
});
