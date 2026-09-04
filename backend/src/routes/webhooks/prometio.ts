/**
 * Webhooks salientes de PrometIO (docs/08). Formato real del emisor (app/core/webhook_saliente.py):
 *   body:    { "evento": "...", "timestamp": ISO, "data": {...} }
 *   headers: X-Prometio-Signature: sha256=<hmac_sha256_hex(secreto, body)>  ·  X-Prometio-Timestamp
 * Eventos consumidos:
 *   cotizacion.aprobada  → borrador de proyecto (nunca ejecutable solo) + aviso a ejecutivas/operaciones
 *   empresa.creada / empresa.actualizada → upsert de cliente con el MISMO id
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';
import { serviceClient, upsertClienteDesdePrometio, audit, throwIf, getCliente } from '../../lib/db';
import { notificar } from '../../lib/notificaciones';

export const prometioWebhook = new Hono();

const empresa = z.object({ id: z.string().uuid(), nombre: z.string(), activo: z.boolean().default(true), ruc: z.string().nullable().optional(), logo_url: z.string().nullable().optional() });

const envelope = z.object({
  evento: z.string(),
  timestamp: z.string().optional(),
  data: z.record(z.unknown()),
});

const cotizacionAprobada = z.object({
  cotizacion_id: z.string().uuid(),
  numero: z.string().nullable().optional(),
  oportunidad_id: z.string().uuid().nullable().optional(),
  empresa,
  valor: z.number().nullable().optional(),
  valido_hasta: z.string().nullable().optional(),
  lineas: z.array(z.object({ servicio: z.string(), cantidad: z.number(), descripcion: z.string().nullable().optional() })).default([]),
});

function verify(raw: string, sig: string | undefined): boolean {
  const secret = env().PROMETIO_WEBHOOK_SECRET;
  if (!secret) return env().NODE_ENV !== 'production';
  if (!sig) return false;
  const hex = sig.replace(/^sha256=/, '');
  const esperado = createHmac('sha256', secret).update(raw).digest('hex');
  return hex.length === esperado.length && timingSafeEqual(Buffer.from(hex), Buffer.from(esperado));
}

async function tenantDefault(): Promise<string> {
  const { data, error } = await serviceClient().from('tenants').select('id').eq('activo', true).order('created_at').limit(1).single();
  throwIf(error);
  return (data as { id: string }).id;
}

prometioWebhook.post('/', async (c) => {
  const raw = await c.req.text();
  if (!verify(raw, c.req.header('x-prometio-signature') ?? c.req.header('x-signature'))) return c.text('unauthorized', 401);
  let parsedRaw: unknown;
  try { parsedRaw = JSON.parse(raw); } catch { return c.json({ error: 'bad json' }, 400); }
  const env1 = envelope.safeParse(parsedRaw);
  if (!env1.success) return c.json({ error: 'payload inválido', detalle: env1.error.issues }, 400);
  const { evento, data } = env1.data;
  const tenantId = await tenantDefault();
  const ctx = { db: serviceClient(), tenantId, usuarioId: null, origen: 'webhook:prometio' as const };

  if (evento === 'empresa.creada' || evento === 'empresa.actualizada') {
    const e = empresa.safeParse(data);
    if (!e.success) return c.json({ error: 'empresa inválida', detalle: e.error.issues }, 400);
    const cl = await upsertClienteDesdePrometio(ctx, { id: e.data.id, nombre: e.data.nombre, activo: e.data.activo });
    if (e.data.logo_url) await ctx.db.from('clientes').update({ logo_url: e.data.logo_url }).eq('id', cl.id).is('logo_url', null);
    await audit(ctx, { accion: evento, entidad: 'cliente', entidad_id: cl.id });
    return c.json({ ok: true, cliente_id: cl.id });
  }

  if (evento === 'cotizacion.aprobada') {
    const p = cotizacionAprobada.safeParse(data);
    if (!p.success) return c.json({ error: 'cotización inválida', detalle: p.error.issues }, 400);
    const cot = p.data;
    // Garantiza que el cliente exista (mismo id que PrometIO).
    const cliente = (await getCliente(ctx, cot.empresa.id)) ?? (await upsertClienteDesdePrometio(ctx, { id: cot.empresa.id, nombre: cot.empresa.nombre, activo: cot.empresa.activo }));
    const principal = cot.lineas[0]?.servicio;
    const { data: mapeo } = principal
      ? await ctx.db.from('mapeo_servicios').select('plantilla_id').eq('tenant_id', tenantId).ilike('servicio_prometio', principal).maybeSingle()
      : { data: null };
    const { data: fila, error } = await ctx.db
      .from('proyecto_borradores')
      .upsert({
        tenant_id: tenantId, cliente_id: cliente.id, prometio_cotizacion_id: cot.cotizacion_id,
        plantilla_sugerida_id: (mapeo as { plantilla_id: string } | null)?.plantilla_id ?? null, payload: cot,
      }, { onConflict: 'tenant_id,prometio_cotizacion_id' })
      .select().single();
    throwIf(error);
    const borrador = fila as { id: string };
    await audit(ctx, { accion: 'cotizacion_ganada', entidad: 'proyecto_borrador', entidad_id: borrador.id, detalle: { cliente_id: cliente.id, cotizacion: cot.numero ?? cot.cotizacion_id } });
    await notificar(ctx, {
      tipo: 'borrador_proyecto',
      titulo: `Cotización ganada: ${cliente.nombre}${cot.numero ? ` (${cot.numero})` : ''}`,
      cuerpo: `PrometIO reporta una cotización aprobada${cot.valor ? ` por USD ${cot.valor}` : ''}.\nLíneas: ${cot.lineas.map((l) => `${l.servicio} ×${l.cantidad}`).join(', ') || 'sin detalle'}.\nHay un borrador de proyecto listo para revisar y confirmar en el Builder.`,
      ruta: '/proyectos/nuevo', entidad_tipo: 'proyecto_borrador', entidad_id: borrador.id,
    }, { roles: ['ejecutiva', 'operaciones'] });
    return c.json({ ok: true, borrador_id: borrador.id });
  }

  // Eventos que no nos interesan (p. ej. contacto.creado_formulario): 200 para que PrometIO no reintente.
  return c.json({ ok: true, ignorado: evento });
});
