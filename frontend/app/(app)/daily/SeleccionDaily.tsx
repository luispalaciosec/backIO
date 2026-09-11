'use client';
import { useEffect, useState } from 'react';
import type { RequerimientoMetricas, Cliente } from '@backio/shared';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { fecha } from '@/lib/format';

/** Elegir qué se trabaja hoy: marca daily_fecha = hoy en las tareas seleccionadas. */
export function SeleccionDaily({ hoy, mesas }: { hoy: string; mesas: { id: string; nombre: string }[] }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [mesa, setMesa] = useState('');
  const [items, setItems] = useState<RequerimientoMetricas[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!abierto) return;
    Promise.all([api<{ items: RequerimientoMetricas[] }>('/requerimientos?activos=1'), api<{ items: Cliente[] }>('/clientes?todos=1')]).then(([r, c]) => { setItems(r.items); setClientes(c.items); }).catch((e) => setErr(e instanceof ApiError ? e.message : 'Error'));
  }, [abierto]);
  const nc = (id: string) => clientes.find((c) => c.id === id)?.nombre ?? '';
  const visibles = items.filter((r) => (!mesa || clientes.find((c) => c.id === r.cliente_id)?.mesa_id === mesa) && (!q || `${r.titulo_interno} ${nc(r.cliente_id)}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (b.daily_fecha === hoy ? 1 : 0) - (a.daily_fecha === hoy ? 1 : 0) || (a.fecha_entrega ?? '9999').localeCompare(b.fecha_entrega ?? '9999'));
  async function toggle(r: RequerimientoMetricas) {
    setBusy(r.id); setErr(null);
    const nuevo = r.daily_fecha === hoy ? null : hoy;
    try { await api(`/requerimientos/${r.id}`, { method: 'PATCH', json: { daily_fecha: nuevo } }); setItems((xs) => xs.map((x) => (x.id === r.id ? { ...x, daily_fecha: nuevo } : x))); router.refresh(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Error'); }
    setBusy(null);
  }
  const seleccionadas = items.filter((r) => r.daily_fecha === hoy).length;
  return (
    <>
      <button className="btn-secondary" onClick={() => setAbierto(true)}>🎯 Elegir tareas de hoy{seleccionadas ? ` (${seleccionadas})` : ''}</button>
      {abierto && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50" onClick={() => setAbierto(false)}>
          <div className="card w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 flex items-center gap-2 flex-wrap">
              <div className="font-semibold flex-1">Qué se trabaja hoy · {fecha(hoy)}</div>
              <select className="input w-40" value={mesa} onChange={(e) => setMesa(e.target.value)}><option value="">Todas las mesas</option>{mesas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select>
              <input className="input w-56" placeholder="Buscar tarea o cliente…" value={q} onChange={(e) => setQ(e.target.value)} />
              <button className="btn-primary" onClick={() => setAbierto(false)}>Listo</button>
            </div>
            {err && <p className="px-4 pt-2 text-sm text-red-600">{err}</p>}
            <div className="overflow-auto flex-1 divide-y divide-gray-100">
              {visibles.map((r) => (
                <label key={r.id} className={`flex items-center gap-3 px-4 py-2 text-sm cursor-pointer hover:bg-gray-50 ${r.daily_fecha === hoy ? 'bg-brand/5' : ''}`}>
                  <input type="checkbox" checked={r.daily_fecha === hoy} disabled={busy === r.id} onChange={() => toggle(r)} />
                  <span className="flex-1 min-w-0"><span className="font-medium">{r.titulo_interno}</span><span className="text-xs text-gray-500"> · {nc(r.cliente_id)}</span></span>
                  <span className={`text-xs whitespace-nowrap ${r.dias_atraso > 0 ? 'text-red-700' : 'text-gray-500'}`}>{fecha(r.fecha_entrega)}{r.dias_atraso > 0 ? ` · ${r.dias_atraso}d` : ''}</span>
                  {r.planificacion === 'urgente' && <span className="rounded-full bg-red-100 text-red-800 px-2 text-[10px] font-semibold">urgente</span>}
                  {r.planificacion === 'no_planificado' && <span className="rounded-full bg-amber-100 text-amber-800 px-2 text-[10px] font-semibold">no planif.</span>}
                </label>
              ))}
              {visibles.length === 0 && <p className="p-4 text-sm text-gray-400">Sin tareas activas con ese filtro.</p>}
            </div>
            <p className="px-4 py-2 text-xs text-gray-500 border-t border-gray-100">Las marcadas salen en la columna «Hoy se trabaja» y en la apertura publicada en Basecamp. También se marcan desde el backlog con ☀. La selección es del día; mañana empieza vacía.</p>
          </div>
        </div>
      )}
    </>
  );
}
