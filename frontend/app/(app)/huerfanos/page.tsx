'use client';
import { useEffect, useState } from 'react';
import type { Cliente } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';
import { fecha, haceCuanto } from '@/lib/format';

interface Huerfano { id: string; cliente_id: string; basecamp_todo_id: number; titulo: string; creador_nombre: string | null; due_on: string | null; completed: boolean; app_url: string | null; detectado_at: string; resuelto_at: string | null; resolucion: string | null }

export default function HuerfanosPage() {
  const [items, setItems] = useState<Huerfano[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cargar = () => Promise.all([api<{ items: Huerfano[] }>('/huerfanos'), api<{ items: Cliente[] }>('/clientes?todos=1')]).then(([h, c]) => { setItems(h.items); setClientes(c.items); }).catch((e) => setError(e instanceof ApiError ? e.message : 'Error'));
  useEffect(() => { void cargar(); }, []);
  const cliente = (id: string) => clientes.find((c) => c.id === id)?.nombre ?? '';
  const porCreador = items.reduce<Record<string, number>>((acc, h) => { const k = h.creador_nombre ?? 'desconocido'; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});

  async function accion(h: Huerfano, tipo: 'adoptar' | 'ignorar') {
    setError(null);
    try { await api(`/huerfanos/${h.id}/${tipo}`, { method: 'POST', json: {} }); setItems((xs) => xs.filter((x) => x.id !== h.id)); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
  }

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Huérfanos</h1>
          <p className="text-sm text-gray-500">To-dos creados a mano en Basecamp sin pasar por BackIO. La regla es cliente → ejecutiva → BackIO → Basecamp; esta lista debería tender a cero.</p>
        </div>
        <button className="btn-secondary" disabled={busy} onClick={async () => { setBusy(true); setMsg(null); try { const r = await api<{ clientes: number; nuevos: number; pendientes: number }>('/huerfanos/detectar', { method: 'POST' }); setMsg(`${r.clientes} clientes revisados · ${r.nuevos} nuevos · ${r.pendientes} pendientes`); await cargar(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); } setBusy(false); }}>{busy ? 'Revisando…' : '↻ Revisar Basecamp ahora'}</button>
      </header>
      {error && <Alert tipo="error">{error}</Alert>}
      {msg && <Alert tipo="info">{msg}</Alert>}
      {Object.keys(porCreador).length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {Object.entries(porCreador).sort((a, b) => b[1] - a[1]).map(([n, k]) => <span key={n} className="rounded-full bg-amber-50 border border-amber-200 text-amber-900 px-3 py-1">{n}: <b>{k}</b></span>)}
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead><tr><th className="th">Cliente</th><th className="th">To-do</th><th className="th">Creado por</th><th className="th">Vence</th><th className="th">Detectado</th><th className="th"></th></tr></thead>
          <tbody>
            {items.map((h) => (
              <tr key={h.id} className={h.completed ? 'opacity-60' : ''}>
                <td className="td whitespace-nowrap">{cliente(h.cliente_id)}</td>
                <td className="td">{h.titulo}{h.app_url && <a className="ml-2 link-action" href={h.app_url} target="_blank" rel="noreferrer">Basecamp ↗</a>}{h.completed && <span className="ml-2 text-xs text-green-700">completado</span>}</td>
                <td className="td">{h.creador_nombre ?? '—'}</td>
                <td className="td whitespace-nowrap">{fecha(h.due_on)}</td>
                <td className="td whitespace-nowrap text-gray-500">{haceCuanto(h.detectado_at)}</td>
                <td className="td whitespace-nowrap"><button className="btn-success px-3 py-1 text-xs mr-2" onClick={() => accion(h, 'adoptar')}>Adoptar</button><button className="btn-ghost px-3 py-1 text-xs" onClick={() => accion(h, 'ignorar')}>Ignorar</button></td>
              </tr>
            ))}
            {items.length === 0 && <tr><td className="td text-gray-400" colSpan={6}>Sin huérfanos pendientes. Así debería verse siempre.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">Adoptar crea el requerimiento en BackIO enlazado al to-do (en el proyecto de su lista si existe). Ignorar lo deja fuera del backlog. La revisión automática corre cada 30 minutos y avisa a operaciones por correo.</p>
    </div>
  );
}
