/**
 * Único directorio que sirve datos SIN autenticación interna.
 * Todo lo que sale de aquí pasa por sanitizeForClient() + assertClientSafe().
 */
import { Hono, type Context } from 'hono';
import { timingSafeEqual } from 'node:crypto';
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

/**
 * PIN del portal: comparación en tiempo constante y bloqueo tras 8 fallos por token+IP durante 15 min
 * (antes se podía forzar por bruta: 6 dígitos sin límite). Devuelve null si pasa, o la respuesta de error.
 */
const fallosPin = new Map<string, { n: number; hasta: number }>();
function verificarPin(c: Context, token: string, pin: string | null): Response | null {
  if (!pin) return null;
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip') ?? 'ip';
  const k = `${token}:${ip}`;
  const f = fallosPin.get(k);
  if (f && f.hasta > Date.now()) return c.json({ error: 'Demasiados intentos. Espera 15 minutos.', requiere_pin: true }, 429);
  const dado = Buffer.from(c.req.header('x-portal-pin') ?? '');
  const esperado = Buffer.from(pin);
  if (dado.length === esperado.length && timingSafeEqual(dado, esperado)) { fallosPin.delete(k); return null; }
  const n = (f && f.hasta > Date.now() - 15 * 60_000 ? f.n : 0) + 1;
  fallosPin.set(k, { n, hasta: n >= 8 ? Date.now() + 15 * 60_000 : 0 });
  if (fallosPin.size > 10_000) fallosPin.clear();
  return c.json({ error: 'PIN requerido', requiere_pin: true }, 401);
}

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
  const bloqueo = verificarPin(c, c.req.param('token'), (r.cliente.config?.portal_pin as string | undefined) ?? null);
  if (bloqueo) return bloqueo;

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
  const bloqueo = verificarPin(c, c.req.param('token'), (r.cliente.config?.portal_pin as string | undefined) ?? null);
  if (bloqueo) return bloqueo;
  const safe = sanitizeForClient(r.proyecto, r.requerimientos);
  try {
    const resumen = await generarResumen(r.proyecto.id, r.proyecto.tenant_id, safe, r.cliente.nombre);
    return c.json({ resumen });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'No se pudo generar el resumen' }, 503);
  }
});
