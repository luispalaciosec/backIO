/**
 * Único directorio que sirve datos SIN autenticación interna.
 * Todo lo que sale de aquí pasa por sanitizeForClient() + assertClientSafe().
 */
import { Hono } from 'hono';
import { serviceClient, getProyectoByPortalToken } from '../lib/db';
import { sanitizeForClient, assertClientSafe } from '../lib/visibility';
import { portalExpirado } from '../lib/portal/token';
import { generarResumen } from '../lib/portal/resumen';

export const portal = new Hono();

portal.use('*', async (c, next) => {
  c.header('X-Robots-Tag', 'noindex, nofollow');
  c.header('Cache-Control', 'private, no-store');
  await next();
});

async function cargar(token: string) {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  const ctx = { db: serviceClient(), tenantId: '', usuarioId: null, origen: 'portal' as const };
  const r = await getProyectoByPortalToken(ctx, token);
  if (!r || portalExpirado(r.proyecto.fecha_entrega)) return null;
  return r;
}

portal.get('/:token', async (c) => {
  const r = await cargar(c.req.param('token'));
  if (!r) return c.json({ error: 'Portal no disponible' }, 404);
  const pin = (r.cliente.config?.portal_pin as string | undefined) ?? null;
  if (pin && c.req.header('x-portal-pin') !== pin) return c.json({ error: 'PIN requerido', requiere_pin: true }, 401);

  const safe = sanitizeForClient(r.proyecto, r.requerimientos);
  const out = {
    ...safe,
    cliente: { nombre: r.cliente.nombre, logo_url: r.cliente.logo_url, color_primario: r.cliente.color_primario },
  };
  assertClientSafe(out);
  return c.json(out);
});

portal.post('/:token/resumen', async (c) => {
  const r = await cargar(c.req.param('token'));
  if (!r) return c.json({ error: 'Portal no disponible' }, 404);
  const pin = (r.cliente.config?.portal_pin as string | undefined) ?? null;
  if (pin && c.req.header('x-portal-pin') !== pin) return c.json({ error: 'PIN requerido', requiere_pin: true }, 401);
  const safe = sanitizeForClient(r.proyecto, r.requerimientos);
  try {
    const resumen = await generarResumen(r.proyecto.id, r.proyecto.tenant_id, safe, r.cliente.nombre);
    return c.json({ resumen });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'No se pudo generar el resumen' }, 503);
  }
});
