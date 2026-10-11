'use client';
/**
 * Captcha de Cloudflare Turnstile (auditoría 10/10, punto 12). Solo se muestra si existe
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY; sin la clave no aparece y los formularios funcionan como antes.
 * El token es de un solo uso: tras un intento fallido, cambia `key` para pedir uno nuevo.
 */
import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => string; remove: (id: string) => void };
  }
}

export const SITE_KEY_TURNSTILE = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let cargando: Promise<void> | null = null;

function cargarScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  cargando ??= new Promise((ok, mal) => {
    const s = document.createElement('script');
    s.src = SCRIPT; s.async = true; s.onload = () => ok(); s.onerror = () => { cargando = null; mal(new Error('Turnstile no cargó')); };
    document.head.appendChild(s);
  });
  return cargando;
}

export function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!SITE_KEY_TURNSTILE || !ref.current) return;
    let id: string | null = null;
    let vivo = true;
    cargarScript().then(() => {
      if (!vivo || !ref.current || !window.turnstile) return;
      id = window.turnstile.render(ref.current, {
        sitekey: SITE_KEY_TURNSTILE, language: 'es', theme: 'light', size: 'flexible',
        callback: (t: string) => onToken(t),
        'expired-callback': () => onToken(null),
        'error-callback': () => onToken(null),
      });
    }).catch(() => onToken(null));
    return () => { vivo = false; if (id && window.turnstile) window.turnstile.remove(id); };
  }, [onToken]);
  if (!SITE_KEY_TURNSTILE) return null;
  return <div ref={ref} className="w-full min-h-[65px]" />;
}
