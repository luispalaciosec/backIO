'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { dinero } from '@/lib/format';

type Mes = { mes: string; fee: number | null; costo: number; margen: number | null; margen_pct: number | null; horas: number };
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Rentabilidad del cliente en los últimos 6 meses (docs/21). La ficha solo la monta para gerencia y admin. */
export function RentabilidadCliente({ clienteId }: { clienteId: string }) {
  const [items, setItems] = useState<Mes[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ items: Mes[] }>(`/rentabilidad/clientes/${clienteId}`)
      .then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudo cargar la rentabilidad'));
  }, [clienteId]);

  return (
    <section className="card">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold">Rentabilidad</div>
          <p className="text-xs text-gray-500 mt-0.5">Fee menos sueldos repartidos por horas registradas. Solo gerencia y admin.</p>
        </div>
        <Link href="/rentabilidad/costos" className="btn-secondary text-xs">
          Sueldos y fees
        </Link>
      </div>
      {error && <p className="p-4 text-sm text-red-600">{error}</p>}
      {!items && !error && <p className="p-4 text-sm text-gray-500">Cargando…</p>}
      {items && (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Mes</th>
                <th className="th text-right">Fee</th>
                <th className="th text-right">Costo</th>
                <th className="th text-right">Margen</th>
                <th className="th text-right">%</th>
                <th className="th text-right">Horas</th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.mes}>
                  <td className="td">
                    <Link href={`/rentabilidad?mes=${m.mes}`} className="hover:underline">
                      {MESES[Number(m.mes.slice(5, 7)) - 1]} {m.mes.slice(2, 4)}
                    </Link>
                  </td>
                  <td className="td text-right tabular-nums">{dinero(m.fee)}</td>
                  <td className="td text-right tabular-nums">{dinero(m.costo)}</td>
                  <td className={`td text-right tabular-nums font-semibold ${m.margen !== null && m.margen < 0 ? 'text-red-600' : ''}`}>
                    {dinero(m.margen)}
                  </td>
                  <td className="td text-right tabular-nums">{m.margen_pct === null ? '—' : `${m.margen_pct} %`}</td>
                  <td className="td text-right tabular-nums">{Math.round(m.horas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.every((m) => m.fee === null) && (
            <p className="px-4 py-3 text-xs text-gray-500">Este cliente no tiene fee cargado: se ve su costo, no su margen.</p>
          )}
        </div>
      )}
    </section>
  );
}
