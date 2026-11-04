'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Acuerdo } from '@backio/shared';
import { hoyLocal } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { fecha } from '@/lib/format';

/** 1. Compromisos vencidos: se cumplió, tiene nueva fecha o se cancela, sin salir de la reunión. */
export function CompromisosWeekly({
  vencidos,
  semanaId,
  nombre,
  escribe,
}: {
  vencidos: Acuerdo[];
  semanaId: string;
  nombre: Record<string, string>;
  escribe: boolean;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [nueva, setNueva] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function hacer(a: Acuerdo, fn: () => Promise<unknown>) {
    setOcupado(a.id);
    setError(null);
    try {
      await fn();
      setEditando(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar');
    }
    setOcupado(null);
  }
  const cerrar = (a: Acuerdo, estado: 'cumplido' | 'cancelado') =>
    hacer(a, () => api(`/semanas/${a.semana_id ?? semanaId}/acuerdos/${a.id}/cerrar`, { method: 'POST', json: { estado } }));

  return (
    <section className="card">
      <div className="px-4 py-3 border-b border-gray-200 font-semibold">1. Compromisos vencidos ({vencidos.length})</div>
      {error && <p className="px-4 pt-3 text-xs text-red-600">{error}</p>}
      <ul className="divide-y divide-gray-100">
        {vencidos.length === 0 && <li className="p-4 text-sm text-gray-400">Sin compromisos vencidos.</li>}
        {vencidos.map((a) => (
          <li key={a.id} className="p-4 text-sm flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div>{a.descripcion}</div>
              <div className="text-xs text-red-700">
                {nombre[a.responsable_id] ?? '—'} · {fecha(a.fecha_compromiso)}
              </div>
            </div>
            {escribe && (
              <div className="flex flex-col items-end gap-1">
                <div className="flex flex-wrap justify-end gap-1">
                  <button className="btn-primary text-xs py-1" disabled={ocupado === a.id} onClick={() => cerrar(a, 'cumplido')}>
                    Cumplido
                  </button>
                  <button
                    className="btn-secondary text-xs py-1"
                    disabled={ocupado === a.id}
                    onClick={() => {
                      setEditando(editando === a.id ? null : a.id);
                      setNueva('');
                    }}
                  >
                    Nueva fecha
                  </button>
                  <button
                    className="btn-ghost text-xs py-1 text-red-700"
                    disabled={ocupado === a.id}
                    onClick={() => cerrar(a, 'cancelado')}
                  >
                    Cancelar
                  </button>
                </div>
                {editando === a.id && (
                  <div className="flex items-center gap-1">
                    <input
                      type="date"
                      aria-label={`Nueva fecha de: ${a.descripcion}`}
                      className="input py-1 text-xs w-36"
                      min={hoyLocal()}
                      value={nueva}
                      onChange={(e) => setNueva(e.target.value)}
                    />
                    <button
                      className="btn-primary text-xs py-1"
                      disabled={!nueva || ocupado === a.id}
                      onClick={() =>
                        hacer(a, () =>
                          api(`/semanas/${a.semana_id ?? semanaId}/acuerdos/${a.id}/fecha`, {
                            method: 'PATCH',
                            json: { fecha_compromiso: nueva },
                          }),
                        )
                      }
                    >
                      Guardar
                    </button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
