'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface Aviso {
  id: string;
  tipo: string;
  titulo: string;
  cuerpo: string;
  ruta: string | null;
  created_at: string;
  leida_at: string | null;
}

const hace = (iso: string) => {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 60) return `hace ${Math.max(1, min)} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`;
};

/** Campana de avisos (docs/22): lo mismo que llega por correo, dentro de BackIO. Se revisa cada 2 minutos. */
export function Campana() {
  const [items, setItems] = useState<Aviso[]>([]);
  const [noLeidas, setNoLeidas] = useState(0);
  const [abierta, setAbierta] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await api<{ items: Aviso[]; no_leidas: number }>('/notificaciones');
      setItems(r.items);
      setNoLeidas(r.no_leidas);
    } catch {
      /* sin campana si falla: no estorba la pantalla */
    }
  }, []);
  useEffect(() => {
    void cargar();
    const t = setInterval(() => void cargar(), 120_000);
    return () => clearInterval(t);
  }, [cargar]);
  useEffect(() => {
    if (!abierta) return;
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierta(false);
    };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierta]);

  async function leer(a: Aviso) {
    setAbierta(false);
    if (a.leida_at) return;
    await api(`/notificaciones/${a.id}/leida`, { method: 'POST' }).catch(() => undefined);
    void cargar();
  }
  async function leerTodas() {
    await api('/notificaciones/leidas', { method: 'POST' }).catch(() => undefined);
    void cargar();
  }

  return (
    <div ref={caja} className="fixed top-3 right-4 z-40">
      <button
        type="button"
        className="relative h-9 w-9 rounded-full border border-gray-200 bg-white shadow-sm flex items-center justify-center hover:bg-gray-50"
        aria-label={noLeidas ? `Avisos: ${noLeidas} sin leer` : 'Avisos'}
        aria-expanded={abierta}
        onClick={() => setAbierta((v) => !v)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {noLeidas > 0 && (
          <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-red-600 text-white text-[11px] font-bold flex items-center justify-center">
            {noLeidas > 9 ? '9+' : noLeidas}
          </span>
        )}
      </button>
      {abierta && (
        <div className="absolute right-0 mt-2 w-[min(24rem,calc(100vw-2rem))] card shadow-lg">
          <div className="px-4 py-2.5 border-b border-gray-200 flex items-center justify-between">
            <span className="font-semibold text-sm">Avisos</span>
            {noLeidas > 0 && (
              <button className="text-xs text-brand hover:underline" onClick={leerTodas}>
                Marcar todo como leído
              </button>
            )}
          </div>
          <ul className="max-h-[70vh] overflow-auto divide-y divide-gray-100">
            {items.length === 0 && <li className="p-4 text-sm text-gray-500">No tienes avisos de los últimos 30 días.</li>}
            {items.map((a) => {
              const cuerpo = (
                <>
                  <div className={`text-sm ${a.leida_at ? 'text-gray-600' : 'font-semibold'}`}>{a.titulo}</div>
                  <div className="text-xs text-gray-500 whitespace-pre-line line-clamp-3">{a.cuerpo}</div>
                  <div className="text-[11px] text-gray-400 mt-0.5">{hace(a.created_at)}</div>
                </>
              );
              return (
                <li key={a.id} className={a.leida_at ? '' : 'bg-blue-50/50'}>
                  {a.ruta ? (
                    <Link href={a.ruta} className="block px-4 py-2.5 hover:bg-gray-50" onClick={() => leer(a)}>
                      {cuerpo}
                    </Link>
                  ) : (
                    <button type="button" className="block w-full text-left px-4 py-2.5 hover:bg-gray-50" onClick={() => leer(a)}>
                      {cuerpo}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
