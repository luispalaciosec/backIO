import { useEffect, useState } from 'react';
import type { TipoPieza } from '@backio/shared';
import { api } from '@/lib/api';
import type { WizardState } from '../wizard';

export function Step3Alcance({ state: s, set }: { state: WizardState; set: (p: Partial<WizardState>) => void }) {
  const plantilla = s.plantilla!;
  const canales = s.brief.canales;
  const activos = plantilla.bloques.filter((b) => s.bloques[b.id]?.activo ?? true);
  const sumaActiva = activos.reduce((acc, b) => acc + b.peso, 0);
  const pesoRedistribuido = (id: string, peso: number) => (sumaActiva ? Math.round((peso / sumaActiva) * 1000) / 10 : 0);

  const upd = (id: string, patch: Partial<WizardState['bloques'][string]>) =>
    set({ bloques: { ...s.bloques, [id]: { ...(s.bloques[id] ?? { bloque_id: id, activo: true, owner_id: null, piezas_por_canal: {} }), ...patch } } });
  const [tipos, setTipos] = useState<TipoPieza[]>([]);
  useEffect(() => { api<{ items: TipoPieza[] }>('/tipos-pieza').then((r) => setTipos(r.items)).catch(() => {}); }, []);
  const totalPiezas = (cfg?: WizardState['bloques'][string]) => Object.values(cfg?.piezas_por_tipo ?? {}).reduce((a, b) => a + (b || 0), 0);

  return (
    <div className="space-y-3">
      {s.piezas_sugeridas && Object.keys(s.piezas_sugeridas).length > 0 && <p className="text-sm rounded-md bg-violet-50 border border-violet-200 text-violet-900 px-3 py-2">Del brief del cliente: {tipos.filter((t) => (s.piezas_sugeridas?.[t.id] ?? 0) > 0).map((t) => `${s.piezas_sugeridas?.[t.id]} ${t.nombre.toLowerCase()}`).join(', ')}. Repártelas en los bloques.</p>}
      <p className="text-sm text-gray-500">Desmarca bloques opcionales; su peso se redistribuye proporcionalmente. En cada bloque indica cuántas piezas de cada tipo: cada tipo se expande en un to-do por paso de su flujo (un reel: ideas → guiones → aprobación → storyboards → grabación → edición → aprobación → posteo). El peso se reparte por esfuerzo × cantidad.</p>
      {plantilla.bloques.map((b) => {
        const cfg = s.bloques[b.id];
        const activo = cfg?.activo ?? true;
        return (
          <div key={b.id} className={`card p-4 ${activo ? '' : 'opacity-60'}`}>
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-3">
                <input type="checkbox" checked={activo} disabled={!b.opcional} onChange={(e) => upd(b.id, { activo: e.target.checked })} />
                <span className="font-semibold">{b.nombre}</span>
                {b.opcional && <span className="text-xs text-gray-500">opcional</span>}
              </label>
              <span className="text-sm tabular-nums">{activo ? pesoRedistribuido(b.id, b.peso) : 0}% del proyecto <span className="text-gray-400">(base {b.peso}%)</span></span>
            </div>
            {activo && (
              <>
                <ul className="mt-3 text-sm text-gray-600 grid gap-1 sm:grid-cols-2">
                  {b.tareas.map((t) => (
                    <li key={t.id} className="flex items-center gap-2"><span className="text-gray-400">▸</span>{t.titulo_interno}{t.visible_cliente_default && <span className="text-xs text-brand">👁 {t.etiqueta_cliente}</span>}</li>
                  ))}
                </ul>
                {tipos.length > 0 && (
                  <div className="mt-3 rounded-md bg-gray-50 border border-gray-200 p-3">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Piezas de este bloque</div>
                      <label className="text-xs flex items-center gap-1 text-gray-600"><input type="checkbox" checked={cfg?.una_tarea_por_pieza ?? false} onChange={(e) => upd(b.id, { una_tarea_por_pieza: e.target.checked })} /> una tarea por pieza</label>
                    </div>
                    <div className="flex flex-wrap gap-4">
                      {tipos.map((t) => (
                        <label key={t.id} className="flex items-center gap-2 text-sm" title={`Flujo: ${t.pasos.map((p) => p.titulo).join(' → ')} · esfuerzo ${t.esfuerzo}`}>
                          <span className="w-28 text-gray-700">{t.nombre}</span>
                          <input type="number" min={0} className="input w-20" value={cfg?.piezas_por_tipo?.[t.id] ?? 0} onChange={(e) => upd(b.id, { piezas_por_tipo: { ...(cfg?.piezas_por_tipo ?? {}), [t.id]: Number(e.target.value) } })} />
                        </label>
                      ))}
                      {totalPiezas(cfg) > 0 && <span className="text-xs text-gray-500 self-center">→ {tipos.filter((t) => (cfg?.piezas_por_tipo?.[t.id] ?? 0) > 0).reduce((n, t) => n + t.pasos.length * (cfg?.una_tarea_por_pieza ? (cfg?.piezas_por_tipo?.[t.id] ?? 0) : 1), 0)} tareas generadas por flujo</span>}
                    </div>
                  </div>
                )}
                {canales.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-3">
                    {canales.map((c) => (
                      <label key={c} className="flex items-center gap-2 text-sm">
                        <span className="w-24 text-gray-600">{c}</span>
                        <input type="number" min={0} className="input w-20" value={cfg?.piezas_por_canal[c] ?? 0} onChange={(e) => upd(b.id, { piezas_por_canal: { ...(cfg?.piezas_por_canal ?? {}), [c]: Number(e.target.value) } })} />
                        <span className="text-xs text-gray-400">piezas</span>
                      </label>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
