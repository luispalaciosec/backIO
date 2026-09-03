'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PreviewImport } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';

const EJEMPLO = `cliente_slug,proyecto,titulo_interno,etiqueta_cliente,visible,bloque,peso,tipo,prioridad,fecha_pedido,fecha_entrega,owner_email,piezas
cerveceria,Trade Q4,POP PROMO CADENAS,Material POP,true,Producción,3,fee,alta,2026-08-20,2026-08-31,elias@geeks.ec,29`;

export default function ImportarPage() {
  const router = useRouter();
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<PreviewImport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function previsualizar() {
    setBusy(true); setError(null);
    try { setPreview(await api<PreviewImport>('/requerimientos/bulk/preview', { method: 'POST', body: csv, headers: { 'Content-Type': 'text/csv' } })); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
    setBusy(false);
  }
  async function confirmar() {
    setBusy(true); setError(null);
    try {
      const r = await api<{ creados: number }>('/requerimientos/bulk', { method: 'POST', body: csv, headers: { 'Content-Type': 'text/csv' } });
      alert(`${r.creados} requerimientos creados`);
      router.push('/backlog');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); setBusy(false); }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">Carga masiva (CSV)</h1>
      <p className="text-sm text-gray-500">Preview obligatorio. Import transaccional: o entran todas las filas o ninguna. <code>visible=true</code> exige <code>etiqueta_cliente</code>.</p>
      <textarea className="input font-mono text-xs" rows={10} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={EJEMPLO} />
      <input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
      <div className="flex gap-2">
        <button className="btn-secondary" disabled={!csv || busy} onClick={previsualizar}>Previsualizar</button>
        <button className="btn-primary" disabled={!preview || preview.rechazadas.length > 0 || preview.validas.length === 0 || busy} onClick={confirmar}>Confirmar import ({preview?.validas.length ?? 0})</button>
      </div>
      {error && <Alert tipo="error">{error}</Alert>}
      {preview && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card"><div className="px-4 py-2 border-b font-semibold text-green-800">Válidas ({preview.validas.length})</div>
            <ul className="p-3 text-sm space-y-1 max-h-80 overflow-auto">{preview.validas.map((f) => <li key={f.fila}>#{f.fila} · {f.cliente_slug} · {f.titulo_interno}</li>)}</ul></div>
          <div className="card"><div className="px-4 py-2 border-b font-semibold text-red-800">Rechazadas ({preview.rechazadas.length})</div>
            <ul className="p-3 text-sm space-y-1 max-h-80 overflow-auto">{preview.rechazadas.map((r) => <li key={r.fila}>#{r.fila} · {r.datos.titulo_interno || '(sin título)'} — <span className="text-red-700">{r.motivo}</span></li>)}</ul></div>
        </div>
      )}
    </div>
  );
}
