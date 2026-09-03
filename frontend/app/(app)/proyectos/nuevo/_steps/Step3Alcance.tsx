import type { WizardState } from '../wizard';

export function Step3Alcance({ state: s, set }: { state: WizardState; set: (p: Partial<WizardState>) => void }) {
  const plantilla = s.plantilla!;
  const canales = s.brief.canales;
  const activos = plantilla.bloques.filter((b) => s.bloques[b.id]?.activo ?? true);
  const sumaActiva = activos.reduce((acc, b) => acc + b.peso, 0);
  const pesoRedistribuido = (id: string, peso: number) => (sumaActiva ? Math.round((peso / sumaActiva) * 1000) / 10 : 0);

  const upd = (id: string, patch: Partial<WizardState['bloques'][string]>) =>
    set({ bloques: { ...s.bloques, [id]: { ...(s.bloques[id] ?? { bloque_id: id, activo: true, owner_id: null, piezas_por_canal: {} }), ...patch } } });

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">Desmarca bloques opcionales; su peso se redistribuye proporcionalmente. Define piezas por canal en los bloques de producción.</p>
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
