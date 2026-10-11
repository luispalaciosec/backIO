/**
 * Límite de peticiones persistente (auditoría 10/10, punto 11). Los contadores viven en Postgres (`limites`,
 * migración 28) y sobreviven reinicios, despliegues y réplicas. Si la base no responde o la migración no está
 * aplicada, se usa un contador en memoria: se degrada al comportamiento anterior, nunca se queda sin límite.
 */
import type { Context, MiddlewareHandler } from 'hono';
import { serviceClient } from './db/client';

export interface EstadoLimite { n: number; excedido: boolean; reintentarEn: number }

const memoria = new Map<string, { inicio: number; n: number }>();
let avisado = false;
function enMemoria(clave: string, max: number, ventanaSeg: number, sumar: boolean): EstadoLimite {
  const ahora = Date.now();
  let e = memoria.get(clave);
  if (!e || e.inicio < ahora - ventanaSeg * 1000) { e = { inicio: ahora, n: 0 }; if (sumar) memoria.set(clave, e); }
  if (sumar) e.n += 1;
  if (memoria.size > 20_000) for (const [k, v] of memoria) if (v.inicio < ahora - 86_400_000) memoria.delete(k);
  return { n: e.n, excedido: e.n > max, reintentarEn: Math.max(0, Math.ceil((e.inicio + ventanaSeg * 1000 - ahora) / 1000)) };
}

async function rpc(fn: 'limite_sumar' | 'limite_estado', clave: string, max: number, ventanaSeg: number): Promise<EstadoLimite> {
  try {
    const { data, error } = await serviceClient().rpc(fn, { p_clave: clave, p_max: max, p_ventana_seg: ventanaSeg });
    if (error) throw new Error(error.message);
    const fila = (Array.isArray(data) ? data[0] : data) as { n: number; excedido: boolean; reintentar_en: number } | undefined;
    if (!fila) throw new Error('sin respuesta');
    return { n: fila.n, excedido: fila.excedido, reintentarEn: fila.reintentar_en };
  } catch (err) {
    if (!avisado) { avisado = true; console.warn('[limite] usando contador en memoria:', err instanceof Error ? err.message : err); }
    return enMemoria(clave, max, ventanaSeg, fn === 'limite_sumar');
  }
}

/** Suma un intento y dice si ya se pasó del máximo en la ventana. */
export const sumarIntento = (clave: string, max: number, ventanaSeg: number) => rpc('limite_sumar', clave, max, ventanaSeg);
/** Consulta sin sumar. */
export const estadoLimite = (clave: string, max: number, ventanaSeg: number) => rpc('limite_estado', clave, max, ventanaSeg);

/** Borra el contador (p. ej. al acertar el PIN). */
export async function limpiarLimite(clave: string): Promise<void> {
  memoria.delete(clave);
  try { await serviceClient().from('limites').delete().eq('clave', clave); } catch { /* sin tabla: solo memoria */ }
}

/** Middleware: `max` peticiones por `ventanaSeg` segundos por la clave que devuelva `claveDe`. Responde 429. */
export function limitar(nombre: string, max: number, ventanaSeg: number, claveDe: (c: Context) => string): MiddlewareHandler {
  return async (c, next) => {
    const r = await sumarIntento(`${nombre}:${claveDe(c)}`, max, ventanaSeg);
    if (r.excedido) return c.json({ error: 'Demasiadas solicitudes. Intenta más tarde.' }, 429, { 'Retry-After': String(r.reintentarEn || ventanaSeg) });
    await next();
  };
}
