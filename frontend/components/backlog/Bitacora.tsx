'use client';
import { useEffect, useState } from 'react';
import type { Bitacora, Usuario } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { fecha, ESTADO_LABEL, APROBACION_LABEL } from '@/lib/format';

/** Bitácora de una tarea: observaciones fechadas con el estado del momento. Reemplaza la hoja "Control de tareas". */
export function BitacoraReq({ requerimientoId, usuarios, visibleCliente, onCambio, compacto = false }: { requerimientoId: string; usuarios: Pick<Usuario, 'id' | 'nombre'>[]; visibleCliente: boolean; onCambio?: () => void; compacto?: boolean }) {
  const [items, setItems] = useState<Bitacora[] | null>(null);
  const [nota, setNota] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cargar = () => api<{ items: Bitacora[] }>(`/requerimientos/${requerimientoId}/bitacora`).then((r) => setItems(r.items)).catch((e) => setErr(e instanceof ApiError ? e.message : 'Error'));
  useEffect(() => { void cargar(); }, [requerimientoId]); // eslint-disable-line react-hooks/exhaustive-deps
  const nombre = (id: string | null) => usuarios.find((u) => u.id === id)?.nombre ?? '—';

  async function guardar() {
    const n = nota.trim(); if (!n) return;
    setBusy(true); setErr(null);
    try { await api(`/requerimientos/${requerimientoId}/bitacora`, { method: 'POST', json: { nota: n, visible_cliente: visible } }); setNota(''); setVisible(false); await cargar(); onCambio?.(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'No se pudo guardar'); }
    setBusy(false);
  }
  async function borrar(b: Bitacora) {
    if (!confirm('¿Borrar esta nota de la bitácora?')) return;
    try { await api(`/requerimientos/${requerimientoId}/bitacora/${b.id}`, { method: 'DELETE' }); await cargar(); onCambio?.(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Error'); }
  }
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-gray-200 bg-gray-50 p-3 space-y-2">
        <textarea className="input" rows={compacto ? 2 : 3} maxLength={2000} placeholder="¿Qué pasó con esta tarea? Lo que le dirías al cliente en la reunión…" value={nota} onChange={(e) => setNota(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void guardar(); }} autoFocus={compacto} />
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <label className={`flex items-center gap-2 text-xs ${visibleCliente ? 'text-gray-700' : 'text-gray-400'}`} title={visibleCliente ? 'La nota se mostrará al cliente en su portal' : 'La tarea está oculta al cliente: la nota queda interna aunque la marques'}>
            <input type="checkbox" checked={visible} disabled={!visibleCliente} onChange={(e) => setVisible(e.target.checked)} /> Visible para el cliente
          </label>
          <button className="btn-primary text-xs py-1" disabled={busy || !nota.trim()} onClick={guardar}>{busy ? 'Guardando…' : 'Anotar'}</button>
        </div>
        {err && <p className="text-xs text-red-600">{err}</p>}
      </div>
      {items === null && <p className="text-sm text-gray-400">Cargando…</p>}
      {items && items.length === 0 && <p className="text-sm text-gray-400">Sin observaciones todavía.</p>}
      {items && items.length > 0 && (
        <ol className="relative border-l border-gray-200 ml-2 space-y-3">
          {items.map((b) => (
            <li key={b.id} className="ml-4">
              <span className={`absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white ${b.visible_cliente ? 'bg-brand' : 'bg-gray-300'}`} />
              <div className="text-xs text-gray-500 flex flex-wrap gap-x-2"><b className="text-gray-700">{fecha(b.created_at.slice(0, 10))}</b><span>{nombre(b.usuario_id)}</span>{b.estado_operativo && <span>· {ESTADO_LABEL[b.estado_operativo] ?? b.estado_operativo}</span>}{b.estado_aprobacion && b.estado_aprobacion !== 'no_aplica' && <span>· {APROBACION_LABEL[b.estado_aprobacion] ?? b.estado_aprobacion}</span>}{b.visible_cliente && <span className="text-brand">· 👁 cliente</span>}<button className="text-gray-300 hover:text-red-600" title="Borrar nota" onClick={() => borrar(b)}>×</button></div>
              <div className="text-sm whitespace-pre-wrap">{b.nota}</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
