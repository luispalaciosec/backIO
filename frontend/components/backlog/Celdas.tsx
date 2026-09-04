'use client';
import { useState } from 'react';
import { iniciales } from '@/lib/format';

/** Celda de color sólido con selector nativo superpuesto (click en toda la celda). */
export function CeldaSelect({ valor, opciones, colores, labels, onChange, disabledValues = [] }: {
  valor: string; opciones: readonly string[]; colores: Record<string, string>; labels: Record<string, string>;
  onChange: (v: string) => void | Promise<void>; disabledValues?: string[];
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="relative h-9 min-w-[120px] text-white text-xs font-medium flex items-center justify-center select-none" style={{ backgroundColor: colores[valor] ?? '#C4C4C4', opacity: busy ? 0.6 : 1 }}>
      <span className="truncate px-2">{labels[valor] ?? valor}</span>
      <select
        aria-label="Cambiar"
        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
        value={valor}
        onChange={async (e) => { setBusy(true); await onChange(e.target.value); setBusy(false); }}
      >
        {opciones.map((o) => <option key={o} value={o} disabled={disabledValues.includes(o)}>{labels[o] ?? o}</option>)}
      </select>
    </div>
  );
}

export function CeldaFecha({ valor, onChange, alerta }: { valor: string | null; onChange: (v: string | null) => void | Promise<void>; alerta?: boolean }) {
  return (
    <input
      type="date"
      className={`h-9 w-full bg-transparent text-sm px-2 text-center focus:outline-none focus:ring-2 focus:ring-brand/40 ${alerta ? 'text-red-600 font-semibold' : ''}`}
      value={valor ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
    />
  );
}

export function CeldaTexto({ valor, onCommit, placeholder, className = '' }: { valor: string; onCommit: (v: string) => void | Promise<void>; placeholder?: string; className?: string }) {
  const [v, setV] = useState(valor);
  return (
    <input
      className={`h-9 w-full bg-transparent text-sm px-2 focus:outline-none focus:ring-2 focus:ring-brand/40 focus:bg-white ${className}`}
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== valor && onCommit(v)}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setV(valor); }}
    />
  );
}

const AVATAR_COLORS = ['#E2445C', '#0073EA', '#00C875', '#A25DDC', '#FDAB3D', '#579BFC', '#FF642E', '#0086C0'];
export function Avatar({ nombre, size = 28 }: { nombre: string; size?: number }) {
  const idx = [...nombre].reduce((s, ch) => s + ch.charCodeAt(0), 0) % AVATAR_COLORS.length;
  return (
    <span title={nombre} className="inline-flex items-center justify-center rounded-full text-white font-semibold ring-2 ring-white" style={{ width: size, height: size, fontSize: size * 0.4, backgroundColor: AVATAR_COLORS[idx] }}>
      {iniciales(nombre) || '?'}
    </span>
  );
}

/** Selector de owners: avatares apilados + select para agregar/quitar. */
export function CeldaOwners({ ids, usuarios, onChange }: { ids: string[]; usuarios: { id: string; nombre: string }[]; onChange: (ids: string[]) => void | Promise<void> }) {
  const [abierto, setAbierto] = useState(false);
  const seleccionados = ids.map((id) => usuarios.find((u) => u.id === id)).filter((u): u is { id: string; nombre: string } => !!u);
  return (
    <div className="relative h-9 flex items-center justify-center">
      <button type="button" className="flex -space-x-2 items-center" onClick={() => setAbierto((a) => !a)} title={seleccionados.map((u) => u.nombre).join(', ') || 'Asignar'}>
        {seleccionados.length === 0 && <span className="inline-flex items-center justify-center rounded-full border-2 border-dashed border-gray-300 text-gray-400" style={{ width: 28, height: 28, fontSize: 14 }}>+</span>}
        {seleccionados.slice(0, 3).map((u) => <Avatar key={u.id} nombre={u.nombre} />)}
        {seleccionados.length > 3 && <span className="inline-flex items-center justify-center rounded-full bg-gray-200 text-gray-700 text-[10px] ring-2 ring-white" style={{ width: 28, height: 28 }}>+{seleccionados.length - 3}</span>}
      </button>
      {abierto && (
        <div className="absolute z-20 top-full left-1/2 -translate-x-1/2 mt-1 w-56 card p-2 shadow-lg" onMouseLeave={() => setAbierto(false)}>
          {usuarios.map((u) => {
            const on = ids.includes(u.id);
            return (
              <label key={u.id} className="flex items-center gap-2 px-2 py-1 text-sm rounded hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" checked={on} onChange={() => onChange(on ? ids.filter((x) => x !== u.id) : [...ids, u.id])} />
                <Avatar nombre={u.nombre} size={22} /> {u.nombre}
              </label>
            );
          })}
          {usuarios.length === 0 && <div className="text-xs text-gray-400 p-2">Sin usuarios</div>}
        </div>
      )}
    </div>
  );
}
