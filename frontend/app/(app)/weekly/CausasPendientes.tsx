'use client';
import { useEffect, useState } from 'react';
import type { Reprogramacion, Reproceso, MotivoReprogramacion, MotivoReproceso } from '@backio/shared';
import { MOTIVOS_REPROGRAMACION, MOTIVOS_REPROCESO } from '@backio/shared';
import { api } from '@/lib/api';
import { fecha } from '@/lib/format';

/** Reprogramaciones y reprocesos sin causa registrada: se completan aquí, en el weekly, sin salir a buscarlos. */
export function CausasPendientes({ titulos, escribe }: { titulos: Record<string, string>; escribe: boolean }) {
  const [d, setD] = useState<{ reprogramaciones: Reprogramacion[]; reprocesos: Reproceso[] } | null>(null);
  const cargar = () => api<{ reprogramaciones: Reprogramacion[]; reprocesos: Reproceso[] }>('/requerimientos/causas-pendientes').then(setD).catch(() => setD({ reprogramaciones: [], reprocesos: [] }));
  useEffect(() => { void cargar(); }, []);
  if (!d) return null;
  const n = d.reprogramaciones.length + d.reprocesos.length;
  const t = (id: string) => titulos[id] ?? 'Requerimiento';
  return (
    <section className="card">
      <div className="px-4 py-3 border-b border-gray-200 font-semibold flex justify-between"><span>Causas pendientes de registrar</span><span className={n ? 'text-amber-700' : 'text-gray-400'}>{n}</span></div>
      <ul className="divide-y divide-gray-100 text-sm">
        {n === 0 && <li className="p-4 text-gray-400">Todas las reprogramaciones y reprocesos tienen causa. Así se pueden atribuir.</li>}
        {d.reprogramaciones.map((x) => (
          <li key={x.id} className="p-3 flex items-center gap-3 flex-wrap">
            <span className="flex-1 min-w-48"><b>{t(x.requerimiento_id)}</b> · fecha {fecha(x.fecha_anterior)} → {fecha(x.fecha_nueva)} <span className="text-xs text-gray-500">({x.origen}, {fecha(x.created_at.slice(0, 10))})</span></span>
            {escribe ? <select className="input w-60 py-1 text-xs border-amber-300" defaultValue="" onChange={async (e) => { if (!e.target.value) return; await api(`/requerimientos/reprogramaciones/${x.id}`, { method: 'PATCH', json: { motivo: e.target.value as MotivoReprogramacion } }); void cargar(); }}><option value="">Causa de la reprogramación…</option>{MOTIVOS_REPROGRAMACION.map((m) => <option key={m.valor} value={m.valor}>{m.label}</option>)}</select> : <span className="text-xs text-amber-700">sin causa</span>}
          </li>
        ))}
        {d.reprocesos.map((x) => (
          <li key={x.id} className="p-3 flex items-center gap-3 flex-wrap">
            <span className="flex-1 min-w-48"><b>{t(x.requerimiento_id)}</b> · reproceso {x.origen === 'basecamp' ? 'desmarcado en Basecamp' : x.origen} <span className="text-xs text-gray-500">({fecha(x.abierto_at.slice(0, 10))}{x.cerrado_at ? '' : ', abierto'})</span></span>
            {escribe ? <select className="input w-60 py-1 text-xs border-amber-300" defaultValue="" onChange={async (e) => { if (!e.target.value) return; await api(`/requerimientos/${x.requerimiento_id}/reprocesos/${x.id}`, { method: 'PATCH', json: { motivo: e.target.value as MotivoReproceso } }); void cargar(); }}><option value="">Causa del reproceso…</option>{MOTIVOS_REPROCESO.map((m) => <option key={m.valor} value={m.valor}>{m.label}</option>)}</select> : <span className="text-xs text-amber-700">sin causa</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
