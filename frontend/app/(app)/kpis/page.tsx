'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Usuario } from '@backio/shared';
import { api, BACKEND } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { Alert } from '@/components/ui/Alert';
import { VistaEquipo, FichaPersona, DetalleKpi, useTableroKpis, mesActual, moverMes, nombreMes, type Seleccion } from '@/components/kpis/Kpis';

export default function KpisPage() { return <Suspense><Kpis /></Suspense>; }

function Kpis() {
  const sp = useSearchParams(); const router = useRouter();
  const mes = sp.get('mes') && /^\d{4}-\d{2}$/.test(sp.get('mes')!) ? sp.get('mes')! : mesActual();
  const persona = sp.get('persona');
  const me = useMe();
  const { tablero, error, recargar } = useTableroKpis(mes);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [sel, setSel] = useState<Seleccion | null>(null);
  useEffect(() => { api<{ items: Usuario[] }>('/usuarios').then((r) => setUsuarios(r.items)).catch(() => {}); }, []);
  const ir = (p: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(p)) { if (v) q.set(k, v); else q.delete(k); }
    router.replace(`/kpis?${q.toString()}`);
  };
  const puedeRegistrar = ['admin', 'gerencia', 'operaciones'].includes(me?.rol ?? '');
  const personas = tablero ? tablero.areas.flatMap((a) => (a.kpis[0]?.personas ?? []).map((p) => ({ ...p, area: a.area }))) : [];

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">KPIs</h1>
          <p className="text-sm text-gray-500">Cada KPI se mide por persona y por equipo. El equipo suma los datos de sus integrantes (Σ A ÷ Σ B), no promedia porcentajes.</p>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5 text-sm">
            <button className={`px-3 py-1 rounded ${!persona ? 'bg-brand text-white' : 'text-gray-600'}`} onClick={() => ir({ persona: null })}>Por equipo</button>
            <button className={`px-3 py-1 rounded ${persona ? 'bg-brand text-white' : 'text-gray-600'}`} onClick={() => ir({ persona: persona ?? personas[0]?.usuario_id ?? null })}>Por persona</button>
          </div>
          {persona && <select className="input w-56" value={persona} onChange={(e) => ir({ persona: e.target.value })}>{personas.map((p) => <option key={p.usuario_id} value={p.usuario_id}>{p.nombre}</option>)}</select>}
          <button className="btn-ghost" onClick={() => ir({ mes: moverMes(mes, -1) })} title="Mes anterior">‹</button>
          <div className="text-sm font-medium w-36 text-center capitalize">{nombreMes(mes)}</div>
          <button className="btn-ghost" onClick={() => ir({ mes: moverMes(mes, 1) })} title="Mes siguiente" disabled={mes >= mesActual()}>›</button>
          <button type="button" className="btn-secondary text-xs" title="Descarga el mes con las columnas de la plantilla de KPIs" onClick={async () => {
            const { supabaseBrowser } = await import('@/lib/supabase/client');
            const { data } = await supabaseBrowser().auth.getSession();
            const r = await fetch(`${BACKEND}/api/v1/kpis/export?hasta=${mes}&meses=1`, { headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}` } });
            const url = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = url; a.download = `kpis-${mes}.csv`; a.click(); URL.revokeObjectURL(url);
          }}>⬇ CSV</button>
        </div>
      </header>
      {error && <Alert tipo="error">{error}</Alert>}
      {tablero && (
        <>
          <div className="flex gap-3 flex-wrap text-sm">
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2"><div className="text-xs text-emerald-700">Cumplen (equipo)</div><b className="text-emerald-800 text-lg">{tablero.resumen.cumple}</b></div>
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2"><div className="text-xs text-red-700">No cumplen</div><b className="text-red-800 text-lg">{tablero.resumen.no_cumple}</b></div>
            <div className="rounded-md border border-gray-200 bg-white px-3 py-2"><div className="text-xs text-gray-500">Sin dato</div><b className="text-lg">{tablero.resumen.sin_dato}</b></div>
            {tablero.en_curso && <div className="self-center text-xs text-gray-500">Mes en curso: los automáticos se recalculan en vivo y se congelan el día 1.</div>}
          </div>
          {tablero.sin_area.length > 0 && puedeRegistrar && <Alert tipo="warn">{tablero.sin_area.length} {tablero.sin_area.length === 1 ? 'persona no tiene' : 'personas no tienen'} área y no aparecen en los KPIs: {tablero.sin_area.map((p) => p.nombre).join(', ')}. Asígnala en Admin → Usuarios.</Alert>}
          {!persona && <VistaEquipo tablero={tablero} onAbrir={setSel} onPersona={(id) => ir({ persona: id })} />}
          {persona && <section className="card p-4"><FichaPersona tablero={tablero} usuarioId={persona} onAbrir={setSel} /></section>}
        </>
      )}
      {!tablero && !error && <p className="text-sm text-gray-400">Calculando KPIs…</p>}
      {sel && <DetalleKpi sel={sel} mes={mes} puedeRegistrar={puedeRegistrar} usuarios={usuarios} onClose={() => setSel(null)} onGuardado={recargar} />}
    </div>
  );
}
