import { useState } from 'react';
import type { Plantilla } from '@backio/shared';

const PILARES = ['Marca', 'Crecimiento', 'Transformación', 'Transversal'] as const;
const COLOR: Record<string, string> = { Marca: '#A25DDC', Crecimiento: '#00C875', Transformación: '#579BFC', Transversal: '#FDAB3D', Medios: '#808080' };
const UNIDAD: Record<string, string> = { proyecto: 'Proyecto', mes: 'Fee mensual', pieza: 'Por pieza' };

export function Step1Plantilla({ plantillas, onSelect, seleccionada }: { plantillas: Plantilla[]; onSelect: (id: string) => void; seleccionada: string | null }) {
  const [q, setQ] = useState('');
  const [pilar, setPilar] = useState<string>('');
  const filtradas = plantillas.filter((p) => (!pilar || p.pilar === pilar) && (!q || `${p.nombre} ${p.familia ?? ''} ${p.descripcion ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  const grupos = [...PILARES, null].map((pl) => ({ pilar: pl, items: filtradas.filter((p) => (pl ? p.pilar === pl : !p.pilar || p.pilar === 'Medios')) })).filter((g) => g.items.length);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2 items-center">
        <input className="input max-w-xs" placeholder="Buscar servicio…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5 text-sm">
          <button className={`px-3 py-1 rounded ${!pilar ? 'bg-gray-900 text-white' : 'text-gray-600'}`} onClick={() => setPilar('')}>Todos</button>
          {PILARES.map((pl) => <button key={pl} className={`px-3 py-1 rounded ${pilar === pl ? 'text-white' : 'text-gray-600'}`} style={pilar === pl ? { backgroundColor: COLOR[pl] } : undefined} onClick={() => setPilar(pl)}>{pl}</button>)}
        </div>
        <span className="text-xs text-gray-500">{filtradas.length} plantillas · las del cliente elegido aparecen primero</span>
      </div>
      {plantillas.length === 0 && <div className="text-gray-500">Cargando plantillas…</div>}
      {grupos.map((g) => (
        <section key={g.pilar ?? 'otros'}>
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLOR[g.pilar ?? 'Medios'] }} />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-600">{g.pilar ?? 'Otras'}</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[...g.items].sort((a, b) => Number(!!b.cliente_id) - Number(!!a.cliente_id) || a.nombre.localeCompare(b.nombre)).map((p) => (
              <button key={p.id} onClick={() => onSelect(p.id)} className={`card p-4 text-left hover:border-brand transition ${seleccionada === p.id ? 'border-brand ring-2 ring-brand/30' : ''}`}>
                <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-wide text-gray-500">
                  <span>{UNIDAD[p.unidad ?? ''] ?? p.tipo}{p.recurrente ? ' · recurrente' : ''}</span>
                  {p.cliente_id && <span className="rounded-full bg-brand/10 text-brand px-2 py-0.5 normal-case">del cliente</span>}
                </div>
                <div className="font-semibold mt-1 leading-snug">{p.nombre}</div>
                {p.precio_referencia && <div className="text-xs text-gray-500 mt-1">Ref. {p.precio_referencia}</div>}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
