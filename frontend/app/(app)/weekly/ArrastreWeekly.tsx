'use client';
import { useMemo, useState } from 'react';
import { coincideBusqueda } from '@backio/shared';
import { fecha } from '@/lib/format';
import { AccionesTarea } from './AccionesTarea';

export interface FilaArrastre {
  requerimiento_id: string;
  titulo: string;
  cliente: string;
  owner: string | null;
  veces_reprogramado: number;
  fecha_original: string | null;
  fecha_actual: string | null;
  dias_arrastre: number;
}

/** 3. Arrastre: se hace, se reasigna o se mata, en el mismo lugar. Sin filtro muestra los 15 más reprogramados. */
export function ArrastreWeekly({
  filas,
  total,
  owners,
  usuarios,
  escribe,
}: {
  filas: FilaArrastre[];
  total: number;
  owners: Record<string, string[]>;
  usuarios: { id: string; nombre: string }[];
  escribe: boolean;
}) {
  const [q, setQ] = useState('');
  const [persona, setPersona] = useState('');
  const [cliente, setCliente] = useState('');
  const personas = useMemo(
    () => [...new Set(filas.map((f) => f.owner ?? 'Sin responsable'))].sort((a, b) => a.localeCompare(b, 'es')),
    [filas],
  );
  const clientes = useMemo(() => [...new Set(filas.map((f) => f.cliente))].sort((a, b) => a.localeCompare(b, 'es')), [filas]);
  const filtradas = filas.filter(
    (f) =>
      coincideBusqueda(q, `${f.titulo} ${f.cliente} ${f.owner ?? ''}`) &&
      (!persona || (f.owner ?? 'Sin responsable') === persona) &&
      (!cliente || f.cliente === cliente),
  );
  const conFiltro = !!(q || persona || cliente);
  const visibles = conFiltro ? filtradas : filtradas.slice(0, 15);
  return (
    <section className="card">
      <div className="px-4 py-3 border-b border-gray-200 flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">
          3. Arrastre ({total}
          {!conFiltro && total > 15 ? ', se muestran los 15 más reprogramados' : ''})
        </span>
        <span className="text-xs font-normal text-gray-500">se hace, se reasigna o se mata</span>
      </div>
      {filas.length > 0 && (
        <div className="px-4 py-2 border-b border-gray-100 flex flex-wrap gap-2">
          <input
            className="input w-52 text-xs py-1"
            placeholder="Buscar tarea, cliente o persona"
            aria-label="Buscar en el arrastre"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className="input w-40 text-xs py-1" aria-label="Por persona" value={persona} onChange={(e) => setPersona(e.target.value)}>
            <option value="">Todas las personas</option>
            {personas.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <select className="input w-44 text-xs py-1" aria-label="Por cliente" value={cliente} onChange={(e) => setCliente(e.target.value)}>
            <option value="">Todos los clientes</option>
            {clientes.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
      )}
      <ul className="divide-y divide-gray-100">
        {filas.length === 0 && <li className="p-4 text-sm text-gray-400">Sin arrastre.</li>}
        {filas.length > 0 && visibles.length === 0 && <li className="p-4 text-sm text-gray-400">Nada coincide con el filtro.</li>}
        {visibles.map((a) => (
          <li key={a.requerimiento_id} className="p-3 text-sm flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div>{a.titulo}</div>
              <div className="text-xs text-gray-500">
                {a.cliente} · {a.owner ?? 'sin responsable'} · {fecha(a.fecha_original)} → {fecha(a.fecha_actual)} ·{' '}
                <span className={`font-semibold ${a.veces_reprogramado >= 2 ? 'text-red-600' : 'text-amber-600'}`}>
                  {a.veces_reprogramado}× reprog.
                </span>{' '}
                · {a.dias_arrastre} días
              </div>
            </div>
            {escribe && (
              <AccionesTarea
                tarea={{
                  id: a.requerimiento_id,
                  titulo: a.titulo,
                  fecha_original: a.fecha_original,
                  fecha_actual: a.fecha_actual,
                  veces: a.veces_reprogramado,
                  owners: owners[a.requerimiento_id] ?? [],
                }}
                usuarios={usuarios}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
