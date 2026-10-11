/**
 * Cloudflare Turnstile (auditoría 10/10, punto 12). Activo solo si existe TURNSTILE_SECRET_KEY: sin la clave no se
 * exige nada (así el código puede desplegarse antes de crear el sitio en Cloudflare).
 */
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export const turnstileActivo = (): boolean => !!process.env.TURNSTILE_SECRET_KEY;

export async function verificarTurnstile(token: string | undefined | null, ip?: string): Promise<boolean> {
  const secreto = process.env.TURNSTILE_SECRET_KEY;
  if (!secreto) return true;
  if (!token || token.length > 2048) return false;
  try {
    const form = new URLSearchParams({ secret: secreto, response: token, ...(ip && ip !== 'ip' ? { remoteip: ip } : {}) });
    const r = await fetch(SITEVERIFY, { method: 'POST', body: form, signal: AbortSignal.timeout(5000) });
    const d = (await r.json()) as { success?: boolean };
    return d.success === true;
  } catch (err) {
    console.error('[turnstile] no se pudo verificar', err instanceof Error ? err.message : err);
    return false;
  }
}
