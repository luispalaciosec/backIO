'use client';
import { useEffect, useState } from 'react';
import type { Mesa } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';
import { useIA } from '@/lib/useIA';

interface Informe { id: string; mesa_id: string | null; markdown: string; publicado_at: string | null; created_at: string }

function mesAnterior(): string { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); }

export default function InformesPage() {
  const ia = useIA();
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [items, setItems] = useState<Informe[]>([]);
  const [mesa, setMesa] = useState('');
  const [mes, setMes] = useState(mesAnterior());
  const [abierto, setAbierto] = useState<Informe | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pub, setPub] = useState<string | null>(null);
  const cargar = () => api<{ items: Informe[] }>('/ia/informes').then((r) => setItems(r.items)).catch(() => {});
  useEffect(() => { api<{ items: Mesa[] }>('/mesas').then((r) => { setMesas(r.items.filter((m) => m.activa)); setMesa((v) => v || r.items.find((m) => m.activa)?.id || ''); }).catch(() => {}); void cargar(); }, []);
  const nombreMesa = (id: string | null) => mesas.find((m) => m.id === id)?.nombre ?? '—';
  const titulo = (i: Informe) => i.markdown.split('\n')[0]?.replace(/^#\s*/, '') ?? i.id;

  async function generar() {
    setBusy('gen'); setError(null);
    try { const a = await api<Informe>('/ia/informe-mensual', { method: 'POST', json: { mesa_id: mesa, mes } }); await cargar(); setAbierto(a); setPub(null); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
    setBusy(null);
  }
  async function publicar(i: Informe) {
    setBusy('pub'); setError(null);
    try { const r = await api<{ url: string }>(`/semanas/actas/${i.id}/publicar`, { method: 'POST' }); setPub(r.url); await cargar(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
    setBusy(null);
  }

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Informes mensuales</h1>
          <p className="text-sm text-gray-500">Informe ejecutivo por mesa: entregas, piezas, horas de Basecamp, cotizado vs. horas, señales y arrastre, con lectura y decisiones redactadas por la IA. Se genera solo el día 1 de cada mes; aquí lo revisas y lo publicas en el board Weekly de la mesa.</p>
        </div>
        {ia ? (
          <div className="flex items-center gap-2">
            <select className="input w-40" value={mesa} onChange={(e) => setMesa(e.target.value)}>{mesas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select>
            <input className="input w-40" type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
            <button className="btn-primary" disabled={!mesa || !mes || !!busy} onClick={generar}>{busy === 'gen' ? 'Redactando…' : '✨ Generar informe'}</button>
          </div>
        ) : <span className="text-xs text-gray-400">La capa de IA no está configurada en el backend.</span>}
      </header>
      {error && <Alert tipo="error">{error}</Alert>}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead><tr><th className="th">Informe</th><th className="th">Mesa</th><th className="th">Generado</th><th className="th">Publicado</th><th className="th"></th></tr></thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => { setAbierto(i); setPub(null); }}>
                <td className="td font-medium">{titulo(i)}</td>
                <td className="td">{nombreMesa(i.mesa_id)}</td>
                <td className="td text-gray-500">{new Date(i.created_at).toLocaleDateString('es-EC')}</td>
                <td className="td">{i.publicado_at ? <span className="text-green-700">✓ {new Date(i.publicado_at).toLocaleDateString('es-EC')}</span> : <span className="text-gray-400">borrador</span>}</td>
                <td className="td text-right"><span className="link-action">Ver</span></td>
              </tr>
            ))}
            {items.length === 0 && <tr><td className="td text-gray-400" colSpan={5}>Aún no hay informes. Genera el del mes anterior para la mesa que quieras.</td></tr>}
          </tbody>
        </table>
      </div>
      {abierto && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50" onClick={() => setAbierto(null)}>
          <div className="card max-w-4xl w-full max-h-[88vh] overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3 gap-2 flex-wrap">
              <div className="font-semibold">{titulo(abierto)}</div>
              <div className="flex gap-2">
                <button className="btn-ghost" onClick={() => navigator.clipboard.writeText(abierto.markdown)}>Copiar</button>
                {!abierto.publicado_at && !pub && <button className="btn-success" disabled={!!busy} onClick={() => publicar(abierto)}>{busy === 'pub' ? 'Publicando…' : 'Publicar en Basecamp'}</button>}
                {pub && <a className="btn-secondary" href={pub} target="_blank" rel="noreferrer">Ver en Basecamp ↗</a>}
              </div>
            </div>
            <pre className="whitespace-pre-wrap text-xs font-mono bg-gray-50 p-4 rounded">{abierto.markdown}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
