'use client';
import { useState } from 'react';
import type { SugerenciaCliente } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { useIA } from '@/lib/useIA';

/** Sugerencias de la IA sobre la ficha (docs/21). Se piden con el botón: no se generan solas. */
export function Sugerencias({ clienteId }: { clienteId: string }) {
  const ia = useIA();
  const [items, setItems] = useState<SugerenciaCliente[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!ia) return null;
  async function pedir() {
    setBusy(true);
    setError(null);
    try {
      setItems((await api<{ sugerencias: SugerenciaCliente[] }>(`/clientes/${clienteId}/sugerencias`, { method: 'POST' })).sugerencias);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudieron generar las sugerencias');
    }
    setBusy(false);
  }
  return (
    <section className="card">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-3">
        <span className="font-semibold">Sugerencias de la IA</span>
        <button className="btn-secondary text-xs" disabled={busy} onClick={pedir}>
          {busy ? 'Pensando…' : items ? '↻ Volver a sugerir' : '✨ Sugerir qué hacer'}
        </button>
      </div>
      {error && <p className="px-4 pt-3 text-xs text-red-600">{error}</p>}
      {!items && !error && (
        <p className="p-4 text-sm text-gray-500">
          La IA lee los números de esta ficha y propone qué hacer con la cuenta. No cambia nada ni escribe a nadie.
        </p>
      )}
      {items && (
        <ol className="divide-y divide-gray-100">
          {items.map((s, i) => (
            <li key={i} className="p-4 text-sm space-y-1">
              <div className="font-medium">{s.titulo}</div>
              {s.dato && <div className="text-xs text-gray-500">Dato: {s.dato}</div>}
              <div className="text-gray-700">{s.accion}</div>
            </li>
          ))}
          {items.length === 0 && <li className="p-4 text-sm text-gray-500">La IA no devolvió sugerencias. Vuelve a intentar.</li>}
        </ol>
      )}
    </section>
  );
}
