'use client';
import { useState } from 'react';
import { apiPortal } from '@/lib/api';

export function ResumenEjecutivo({ token, pin }: { token: string; pin?: string }) {
  const [texto, setTexto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function generar() {
    setBusy(true); setErr(null);
    try { setTexto((await apiPortal<{ resumen: string }>(`/${token}/resumen`, { method: 'POST' }, pin)).resumen); }
    catch { setErr('El resumen no está disponible en este momento.'); }
    setBusy(false);
  }
  if (texto) return <div className="rounded-md bg-gray-50 p-4 text-sm leading-relaxed whitespace-pre-line">{texto}</div>;
  return (
    <div>
      <button className="btn-secondary w-full" disabled={busy} onClick={generar}>{busy ? 'Redactando…' : 'Ver resumen ejecutivo'}</button>
      {err && <p className="text-xs text-gray-500 mt-2 text-center">{err}</p>}
    </div>
  );
}
