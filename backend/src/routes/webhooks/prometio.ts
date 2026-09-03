/**
 * Webhooks de PrometIO (docs/08). HMAC-SHA256 en X-Signature.
 *  - cotizacion_ganada → borrador de proyecto (nunca ejecutable solo)
 *  - cliente_creado / cliente_actualizado → upsert por id (mismo uuid)
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';
import { serviceClient, upsertClienteDesdePrometio, audit, throwIf } from '../../lib/db';

export const prometioWebhook = new Hono();

const cotizacion = z.object({
  evento: z.literal('cotizacion_ganada'),
  cotizacion_id: z.string().uuid(),
  cliente_id: z.string().uuid(),
  monto: z.number().optional(),
  fecha_cierre_estimada: z.string().optional(),
  lineas: z.array(z.object({ servicio: z.string(), cantidad: z.number() })).default([]),
});
const clienteEvt = z.object({
  evento: z.enum(['cliente_creado', 'cliente_actualizado']),
  cliente: z.object({ id: z.string().uuid(), nombre: z.string(), activo: z.boolean().default(true) }),
});
const schema = z.discriminatedUnion('evento', [cotizacion, clienteEvt]);

function verify(raw: string, sig: string | undefined): boolean {
  const secret = env().PROMETIO_WEBHOOK_SECRET;
  if (!secret) return env().NODE_ENV !== 'production';
  if (!sig) return false;
  const esperado = createHmac('sha256', secret).update(raw).digest('hex');
  return sig.length === esperado.length && timingSafeEqual(Buffer.from(sig), Buffer.from(esperado));
}

async function tenantDefault(): Promise<string> {
  const { data, error } = await serviceClient().from('tenants').select('id').eq('activo', true).order('created_at').limit(1).single();
  throwIf(error);
  return (data as { id: string }).id;
}

prometioWebhook.post('/', async (c) => {
  const raw = await c.req.text();
  if (!verify(raw, c.req.header('x-signature'))) return c.text('unauthorized', 401);
  const parsed = schema.safeParse(JSON.parse(raw));
  if (!parsed.success) return c.json({ error: 'payload inválido', detalle: parsed.error.issues }, 400);
  const body = parsed.data;
  const tenantId = await tenantDefault();
  const ctx = { db: serviceClient(), tenantId, usuarioId: null, origen: 'webhook:prometio' as const };

  if (body.evento !== 'cotizacion_ganada') {
    const cl = await upsertClienteDesdePrometio(ctx, body.cliente);
    await audit(ctx, { accion: body.evento, entidad: 'cliente', entidad_id: cl.id });
    return c.json({ ok: true, cliente_id: cl.id });
  }
  const cot: z.infer<typeof cotizacion> = body;

  // cotizacion_ganada → borrador. Sugerir plantilla por línea principal.
  const principal = cot.lineas[0]?.servicio;
  const { data: mapeo } = principal
    ? await ctx.db.from('mapeo_servicios').select('plantilla_id').eq('tenant_id', tenantId).ilike('servicio_prometio', principal).maybeSingle()
    : { data: null };
  const { data, error } = await ctx.db
    .from('proyecto_borradores')
    .upsert(
      {
        tenant_id: tenantId,
        cliente_id: cot.cliente_id,
        prometio_cotizacion_id: cot.cotizacion_id,
        plantilla_sugerida_id: (mapeo as { plantilla_id: string } | null)?.plantilla_id ?? null,
        payload: cot,
      },
      { onConflict: 'tenant_id,prometio_cotizacion_id' },
    )
    .select()
    .single();
  throwIf(error);
  const borrador = data as { id: string };
  await audit(ctx, { accion: 'cotizacion_ganada', entidad: 'proyecto_borrador', entidad_id: borrador.id, detalle: { cliente_id: cot.cliente_id } });
  await ctx.db.from('notificaciones').insert({
    tenant_id: tenantId,
    usuario_id: null,
    tipo: 'borrador_proyecto',
    titulo: 'Cotización ganada: revisar borrador de proyecto',
    cuerpo: `Cotización ${cot.cotizacion_id} · ${cot.lineas.map((l) => `${l.servicio} ×${l.cantidad}`).join(', ')}`,
    entidad_tipo: 'proyecto_borrador',
    entidad_id: borrador.id,
  });
  return c.json({ ok: true, borrador_id: borrador.id });
});
