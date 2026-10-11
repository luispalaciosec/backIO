/**
 * Único directorio que sirve datos SIN autenticación interna.
 * Todo lo que sale de aquí pasa por sanitizeForClient() + assertClientSafe().
 */
import { Hono, type Context } from 'hono';
import { createHash, timingSafeEqual } from 'node:crypto';
import { serviceClient, getProyectoByPortalToken } from '../lib/db';
import { sanitizeForClient, assertClientSafe } from '../lib/visibility';
import { portalExpirado } from '../lib/portal/token';
import { generarResumen } from '../lib/portal/resumen';
import { leerHashPin, pinCoincide } from '../lib/portal/pin';
import { ipCliente } from '../lib/ip';
import { estadoLimite, sumarIntento, limpiarLimite, limitar } from '../lib/limite';

export const portal = new Hono();

portal.use('*', async (c, next) => {
  c.header('X-Robots-Tag', 'noindex, nofollow');
  c.header('Cache-Control', 'private, no-store');
  await next();
});

/**
 * PIN del portal: comparación con el hash y bloqueo tras 8 fallos por token+IP o 30 por token (cualquier IP) en
 * 15 min. Los contadores viven en Postgres (`limites`, migración 28): sobreviven reinicios y despliegues.
 */
const VENTANA_SEG = 15 * 60;
const MAX_POR_IP = 8;
const MAX_POR_TOKEN = 30;
/** El token del portal es una credencial: en la tabla de límites solo va su huella. */
const huella = (token: string) => createHash('sha256').update(token).digest('hex').slice(0, 24);

/** Credencial del portal: el hash de `portal_pines` o, solo mientras no se migre, el PIN en claro de config. */
interface PinCliente { hash: string | null; claro: string | null }
function coincide(dado: string, pin: PinCliente): boolean {
  if (pin.hash) return pinCoincide(dado, pin.hash);
  const a = Buffer.from(dado), b = Buffer.from(pin.claro ?? '');
  return a.length === b.length && timingSafeEqual(a, b);
}
async function pinDe(r: { proyecto: { cliente_id: string }; cliente: { config?: Record<string, unknown> | null } }): Promise<PinCliente> {
  const hash = await leerHashPin(r.proyecto.cliente_id);
  const claro = (r.cliente.config?.portal_pin as string | undefined) || null;
  return { hash, claro: hash ? null : claro };
}
async function verificarPin(c: Context, token: string, pin: PinCliente): Promise<Response | null> {
  if (!pin.hash && !pin.claro) return null;
  const kIp = `pin:${huella(token)}:${ipCliente(c)}`;
  const kToken = `pin:${huella(token)}:*`;
  // Bloqueado si ya acumuló el máximo de fallos (por IP o por token) en la ventana.
  const [eIp, eToken] = await Promise.all([estadoLimite(kIp, MAX_POR_IP - 1, VENTANA_SEG), estadoLimite(kToken, MAX_POR_TOKEN - 1, VENTANA_SEG)]);
  if (eIp.excedido || eToken.excedido) return c.json({ error: 'Demasiados intentos. Espera 15 minutos.', requiere_pin: true }, 429);
  if (coincide((c.req.header('x-portal-pin') ?? '').slice(0, 20), pin)) { await limpiarLimite(kIp); return null; }
  await Promise.all([sumarIntento(kIp, MAX_POR_IP, VENTANA_SEG), sumarIntento(kToken, MAX_POR_TOKEN, VENTANA_SEG)]);
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
  const bloqueo = await verificarPin(c, c.req.param('token'), await pinDe(r));
  if (bloqueo) return bloqueo;

  const safe = sanitizeForClient(r.proyecto, r.requerimientos);
  const out = {
    ...safe,
    cliente: { nombre: r.cliente.nombre, logo_url: r.cliente.logo_url, color_primario: r.cliente.color_primario },
  };
  assertClientSafe(out);
  return c.json(out);
});

// El resumen llama a la IA (costo): 10 por hora por enlace, además de la caché de 6 h (auditoría 10/10, punto 11).
portal.post('/:token/resumen', limitar('portal_resumen', 10, 3600, (c) => huella(c.req.param('token') ?? '')), async (c) => {
  const r = await cargar(c.req.param('token'));
  if (!r) return c.json({ error: 'Portal no disponible' }, 404);
  const bloqueo = await verificarPin(c, c.req.param('token'), await pinDe(r));
  if (bloqueo) return bloqueo;
  const safe = sanitizeForClient(r.proyecto, r.requerimientos);
  try {
    const resumen = await generarResumen(r.proyecto.id, r.proyecto.tenant_id, safe, r.cliente.nombre);
    return c.json({ resumen });
  } catch (err) {
    // El detalle (configuración, errores del proveedor de IA o de la base) va al log, nunca al visitante anónimo.
    console.error('[portal] resumen', r.proyecto.id, err instanceof Error ? err.message : err);
    return c.json({ error: 'El resumen no está disponible en este momento. Intenta más tarde.' }, 503);
  }
});
