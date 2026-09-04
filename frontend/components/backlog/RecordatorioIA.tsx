'use client';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';

/** Borrador de correo al cliente para un requerimiento en espera. La ejecutiva copia, ajusta y envía desde su correo. */
export function RecordatorioIA({ requerimientoId, titulo }: { requerimientoId: string; titulo: string }) {
  const [texto, setTexto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function abrir(e: React.MouseEvent) {
    e.stopPropagation(); setBusy(true); setErr(null);
    try { setTexto((await api<{ texto: string }>(`/ia/recordatorio/${requerimientoId}`, { method: 'POST' })).texto); }
    catch (x) { setErr(x instanceof ApiError ? x.message : 'Error'); setTexto(''); }
    setBusy(false);
  }
  return (
    <>
      <button type="button" className="text-xs text-violet-700 hover:underline" title="Redactar recordatorio al cliente (IA)" onClick={abrir} disabled={busy}>{busy ? '…' : '✉'}</button>
      {texto !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50" onClick={() => setTexto(null)}>
          <div className="card max-w-xl w-full p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="font-semibold text-sm">Recordatorio al cliente · {titulo}</div>
            {err ? <p className="text-sm text-red-600">{err}</p> : <textarea className="input font-sans text-sm" rows={10} value={texto} onChange={(e) => setTexto(e.target.value)} />}
            <div className="flex justify-between items-center gap-2">
              <span className="text-xs text-gray-400">BackIO no envía correos al cliente: cópialo y envíalo desde tu correo.</span>
              <div className="flex gap-2"><button className="btn-ghost" onClick={() => setTexto(null)}>Cerrar</button>{!err && <button className="btn-primary" onClick={() => navigator.clipboard.writeText(texto)}>Copiar</button>}</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
