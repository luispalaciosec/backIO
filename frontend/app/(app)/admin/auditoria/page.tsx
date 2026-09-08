'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Usuario } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';

interface Evento { id: number; usuario_id: string | null; api_key_id: string | null; origen: string; accion: string; entidad: string; entidad_id: string | null; detalle: Record<string, unknown> | null; created_at: string }
interface Resultado { items: Evento[]; total: number; con_error: number }
const ORIGENES = ['ui', 'api', 'mcp', 'webhook:basecamp', 'webhook:prometio', 'cron', 'portal'];

export default function AuditoriaPage() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [f, setF] = useState({ usuario: '', accion: '', entidad: '', origen: '', desde: '', hasta: '' });
  const [r, setR] = useState<Resultado | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<Evento | null>(null);
  const cargar = useCallback(async () => {
    setBusy(true); setError(null);
    const qs = new URLSearchParams(); Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v); }); qs.set('limit', '300');
    try { setR(await api<Resultado>(`/admin/audit?${qs}`)); } catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
    setBusy(false);
  }, [f]);
  useEffect(() => { api<{ items: Usuario[] }>('/admin/usuarios').then((x) => setUsuarios(x.items)).catch(() => {}); void cargar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const nombre = (id: string | null) => usuarios.find((u) => u.id === id);
  const esError = (e: Evento) => /rechaz|fall|error|invalid/i.test(e.accion) || !!(e.detalle && 'error' in e.detalle);
  const fecha = (iso: string) => new Date(iso).toLocaleString('es-EC', { timeZone: 'America/Guayaquil', day: 'numeric', month: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit' });
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Auditoría</h1>
        <p className="text-sm text-gray-500">Registro de acciones en BackIO: quién hizo qué, desde dónde y cuándo. Los conteos son sobre el resultado ya filtrado.</p>
      </header>
      <form className="card p-3 flex flex-wrap gap-3 items-end" onSubmit={(e) => { e.preventDefault(); void cargar(); }}>
        <div className="min-w-44"><label className="label">Usuario</label><select className="input" value={f.usuario} onChange={(e) => setF({ ...f, usuario: e.target.value })}><option value="">Todos</option>{usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></div>
        <div className="min-w-40"><label className="label">Acción</label><input className="input" placeholder="reprogramar, crear_proyecto…" value={f.accion} onChange={(e) => setF({ ...f, accion: e.target.value })} /></div>
        <div className="min-w-36"><label className="label">Entidad</label><input className="input" placeholder="requerimiento, proyecto…" value={f.entidad} onChange={(e) => setF({ ...f, entidad: e.target.value })} /></div>
        <div className="min-w-36"><label className="label">Origen</label><select className="input" value={f.origen} onChange={(e) => setF({ ...f, origen: e.target.value })}><option value="">Todos</option>{ORIGENES.map((o) => <option key={o} value={o}>{o}</option>)}</select></div>
        <div><label className="label">Desde</label><input className="input" type="date" value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} /></div>
        <div><label className="label">Hasta</label><input className="input" type="date" value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} /></div>
        <button className="btn-primary" disabled={busy}>{busy ? 'Filtrando…' : 'Filtrar'}</button>
        <button type="button" className="btn-ghost" onClick={() => setF({ usuario: '', accion: '', entidad: '', origen: '', desde: '', hasta: '' })}>Limpiar</button>
      </form>
      {error && <Alert tipo="error">{error}</Alert>}
      {r && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="card p-4"><div className="text-xs uppercase tracking-wide text-gray-500">Total filtrado</div><div className="text-3xl font-bold">{r.total}</div></div>
          <div className="card p-4"><div className="text-xs uppercase tracking-wide text-gray-500">Exitosos</div><div className="text-3xl font-bold text-green-700">{r.total - r.con_error}</div></div>
          <div className="card p-4"><div className="text-xs uppercase tracking-wide text-gray-500">Con error</div><div className={`text-3xl font-bold ${r.con_error ? 'text-red-700' : ''}`}>{r.con_error}</div></div>
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead><tr><th className="th">Fecha</th><th className="th">Usuario</th><th className="th">Acción</th><th className="th">Entidad</th><th className="th">Origen</th><th className="th"></th></tr></thead>
          <tbody>
            {(r?.items ?? []).map((e) => { const u = nombre(e.usuario_id); return (
              <tr key={e.id} className={`hover:bg-gray-50 cursor-pointer ${esError(e) ? 'bg-red-50/40' : ''}`} onClick={() => setAbierto(e)}>
                <td className="td whitespace-nowrap text-gray-600">{fecha(e.created_at)}</td>
                <td className="td">{u ? <><div className="font-medium">{u.nombre}</div><div className="text-xs text-gray-500">{u.email}</div></> : e.api_key_id ? <span className="text-xs text-gray-500">API key</span> : <span className="text-xs text-gray-400">sistema</span>}</td>
                <td className="td"><code className={`text-xs ${esError(e) ? 'text-red-700' : ''}`}>{e.accion}</code></td>
                <td className="td">{e.entidad} {e.entidad_id && <code className="text-xs text-gray-500">{e.entidad_id.slice(0, 8)}</code>}</td>
                <td className="td text-xs text-gray-500">{e.origen}</td>
                <td className="td text-right"><span className="link-action text-xs">detalle</span></td>
              </tr>); })}
            {r && r.items.length === 0 && <tr><td className="td text-gray-400" colSpan={6}>Sin eventos con esos filtros.</td></tr>}
          </tbody>
        </table>
        {r && r.total > r.items.length && <div className="px-4 py-2 text-xs text-gray-500 border-t border-gray-100">Mostrando los {r.items.length} más recientes de {r.total}. Acota con los filtros para ver el resto.</div>}
      </div>
      {abierto && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50" onClick={() => setAbierto(null)}>
          <div className="card w-full max-w-2xl max-h-[80vh] overflow-auto p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start gap-3"><div><div className="font-semibold"><code>{abierto.accion}</code> · {abierto.entidad}</div><div className="text-xs text-gray-500">{fecha(abierto.created_at)} · {abierto.origen} · {nombre(abierto.usuario_id)?.nombre ?? (abierto.api_key_id ? 'API key' : 'sistema')}</div></div><button className="btn-ghost" onClick={() => setAbierto(null)}>×</button></div>
            {abierto.entidad_id && <div className="text-xs text-gray-600">Entidad: <code>{abierto.entidad_id}</code></div>}
            <pre className="text-xs bg-gray-50 rounded p-3 whitespace-pre-wrap">{JSON.stringify(abierto.detalle ?? {}, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
