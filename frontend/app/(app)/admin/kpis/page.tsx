'use client';
import { useEffect, useState } from 'react';
import type { KpiDefinicion, CalculoKpi, Area } from '@backio/shared';
import { AREAS, AREA_LABEL, CALCULO_KPI_LABEL } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';

/** Catálogo de KPIs: metas, operadores, periodicidad, cálculo y textos. Solo admin. */
export default function AdminKpisPage() {
  const [items, setItems] = useState<KpiDefinicion[]>([]);
  const [sel, setSel] = useState<KpiDefinicion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cargar = () => api<{ items: KpiDefinicion[] }>('/kpis/definiciones').then((r) => { setItems(r.items); setSel((s) => (s ? r.items.find((x) => x.id === s.id) ?? r.items[0] ?? null : r.items[0] ?? null)); })
    .catch((e) => setError(e instanceof ApiError ? (/kpi_definiciones|does not exist|schema cache/i.test(e.message) ? 'Falta aplicar la migración 22 de KPIs en Supabase.' : e.message) : 'Error'));
  useEffect(() => { void cargar(); }, []);

  async function guardar() {
    if (!sel) return;
    setBusy(true); setError(null); setOk(null);
    try {
      await api(`/kpis/definiciones/${sel.codigo}`, { method: 'PUT', json: {
        indicador: sel.indicador, periodicidad: sel.periodicidad, operador: sel.operador, meta: Number(sel.meta),
        numerador_label: sel.numerador_label, denominador_label: sel.denominador_label,
        denominador_fijo: sel.denominador_fijo === null || (sel.denominador_fijo as unknown) === '' ? null : Number(sel.denominador_fijo),
        calculo: sel.calculo, fuente: sel.fuente || null, regla: sel.regla || null, formula: sel.formula || null, activo: sel.activo,
      } });
      setOk(`${sel.codigo} guardado`); await cargar();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
    setBusy(false);
  }
  const set = (p: Partial<KpiDefinicion>) => sel && setSel({ ...sel, ...p });

  return (
    <div className="max-w-6xl space-y-4">
      <header>
        <h1 className="text-2xl font-bold">KPIs</h1>
        <p className="text-sm text-gray-500">Definición de cada indicador. La meta aplica a cada persona y al equipo. Los automáticos los calcula BackIO; los manuales se ingresan en Equipo → KPIs.</p>
      </header>
      {error && <Alert tipo="error">{error}</Alert>}
      {ok && <Alert tipo="ok">{ok}</Alert>}
      <div className="grid gap-4 md:grid-cols-[320px_1fr]">
        <nav className="card p-2 space-y-3 self-start">
          {AREAS.map((a: Area) => {
            const delArea = items.filter((k) => k.area === a);
            if (!delArea.length) return null;
            return (
              <div key={a}>
                <div className="px-2 text-[10px] uppercase tracking-wide text-gray-400">{AREA_LABEL[a]}</div>
                {delArea.map((k) => (
                  <button key={k.id} type="button" onClick={() => setSel(k)} className={`w-full text-left rounded px-2 py-1.5 text-sm ${sel?.id === k.id ? 'bg-brand/10 text-brand' : 'hover:bg-gray-50'} ${k.activo ? '' : 'opacity-50'}`}>
                    <div className="font-medium truncate">{k.indicador}</div>
                    <div className="text-[11px] text-gray-400">{k.codigo} · {k.operador === '>=' ? '≥' : '≤'} {Math.round(k.meta * 100)}% · {k.calculo === 'manual' ? 'manual' : 'automático'}</div>
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
        {sel && (
          <section className="card p-4 space-y-3">
            <div className="flex items-center justify-between gap-3"><div className="text-xs text-gray-400">{sel.codigo} · {AREA_LABEL[sel.area]}</div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sel.activo} onChange={(e) => set({ activo: e.target.checked })} /> Activo</label></div>
            <div><label className="label">Indicador</label><input className="input" value={sel.indicador} onChange={(e) => set({ indicador: e.target.value })} /></div>
            <div className="grid gap-3 md:grid-cols-4">
              <div><label className="label">Periodicidad</label><select className="input" value={sel.periodicidad} onChange={(e) => set({ periodicidad: e.target.value as KpiDefinicion['periodicidad'] })}><option value="mensual">Mensual</option><option value="trimestral">Trimestral</option></select></div>
              <div><label className="label">Operador</label><select className="input" value={sel.operador} onChange={(e) => set({ operador: e.target.value as KpiDefinicion['operador'] })}><option value=">=">≥ (más es mejor)</option><option value="<=">≤ (menos es mejor)</option></select></div>
              <div><label className="label">Meta (%)</label><input className="input" type="number" min={0} max={100} step="any" value={Math.round(sel.meta * 10000) / 100} onChange={(e) => set({ meta: Number(e.target.value) / 100 })} /></div>
              <div><label className="label">Cálculo</label><select className="input" value={sel.calculo} onChange={(e) => set({ calculo: e.target.value as CalculoKpi })}>{(Object.keys(CALCULO_KPI_LABEL) as CalculoKpi[]).map((c) => <option key={c} value={c}>{CALCULO_KPI_LABEL[c]}</option>)}</select></div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div><label className="label">Dato A (numerador)</label><input className="input" value={sel.numerador_label} onChange={(e) => set({ numerador_label: e.target.value })} /></div>
              <div><label className="label">Dato B (denominador)</label><input className="input" value={sel.denominador_label} onChange={(e) => set({ denominador_label: e.target.value })} /></div>
            </div>
            {sel.calculo === 'proactividad' && <div className="max-w-xs"><label className="label">Meta mensual por persona (dato B fijo)</label><input className="input" type="number" min={1} value={sel.denominador_fijo ?? ''} onChange={(e) => set({ denominador_fijo: e.target.value === '' ? null : Number(e.target.value) })} /></div>}
            <div><label className="label">Fuente</label><input className="input" value={sel.fuente ?? ''} onChange={(e) => set({ fuente: e.target.value })} /></div>
            <div><label className="label">Regla / leyenda</label><textarea className="input" rows={2} value={sel.regla ?? ''} onChange={(e) => set({ regla: e.target.value })} /></div>
            <div><label className="label">Composición de la fórmula</label><textarea className="input" rows={2} value={sel.formula ?? ''} onChange={(e) => set({ formula: e.target.value })} /></div>
            <div className="flex justify-end"><button className="btn-primary" disabled={busy} onClick={guardar}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
          </section>
        )}
      </div>
    </div>
  );
}
