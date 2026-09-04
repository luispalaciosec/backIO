'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { RequerimientoMetricas, Cliente, Usuario, EstadoOperativo, ActualizarRequerimientoInput } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';
import { BacklogTable } from '@/components/backlog/BacklogTable';
import { KanbanBoard } from '@/components/backlog/KanbanBoard';
import { ESTADO_LABEL } from '@/lib/format';

type Vista = 'tabla' | 'kanban';

export default function BacklogPage() {
  const [items, setItems] = useState<RequerimientoMetricas[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [vista, setVista] = useState<Vista>('tabla');
  const [filtro, setFiltro] = useState({ cliente: '', owner: '', estado: '', activos: true, q: '' });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setLoading(true);
    const qs = new URLSearchParams();
    if (filtro.cliente) qs.set('cliente', filtro.cliente);
    if (filtro.owner) qs.set('owner', filtro.owner);
    if (filtro.estado) qs.set('estado', filtro.estado);
    if (filtro.activos) qs.set('activos', '1');
    if (filtro.q) qs.set('q', filtro.q);
    try {
      const r = await api<{ items: RequerimientoMetricas[] }>(`/requerimientos?${qs}`);
      setItems(r.items);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error cargando backlog');
    } finally {
      setLoading(false);
    }
  }, [filtro]);

  useEffect(() => {
    api<{ items: Cliente[] }>('/clientes').then((r) => setClientes(r.items)).catch(() => {});
    api<{ items: Usuario[] }>('/usuarios').then((r) => setUsuarios(r.items)).catch(() => {});
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  async function patch(id: string, p: ActualizarRequerimientoInput) {
    // Optimista: aplica en memoria y recarga en silencio.
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...(p as Partial<RequerimientoMetricas>) } : r)));
    try {
      await api(`/requerimientos/${id}`, { method: 'PATCH', json: p });
      await cargar(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo actualizar');
      await cargar(true);
    }
  }

  async function crear(clienteId: string, titulo: string) {
    try {
      await api('/requerimientos', { method: 'POST', json: { cliente_id: clienteId, titulo_interno: titulo, tipo_trabajo: 'fee', fecha_pedido: new Date().toISOString().slice(0, 10) } });
      await cargar(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo crear');
    }
  }

  const clientesVisibles = filtro.cliente ? clientes.filter((c) => c.id === filtro.cliente) : clientes.filter((c) => items.some((r) => r.cliente_id === c.id));

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Backlog priorizado</h1>
          <p className="text-sm text-gray-500">{items.length} requerimientos · <span className="font-medium">sin movimiento</span> es la columna que importa</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5 text-sm">
            {(['tabla', 'kanban'] as Vista[]).map((v) => (
              <button key={v} onClick={() => setVista(v)} className={`px-3 py-1.5 rounded ${vista === v ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-100'}`}>{v === 'tabla' ? 'Tabla' : 'Kanban'}</button>
            ))}
          </div>
          <Link href="/proyectos/nuevo" className="btn-primary">+ Nuevo proyecto</Link>
        </div>
      </header>

      <div className="card p-3 flex flex-wrap gap-3 items-end">
        <div className="min-w-44">
          <label className="label">Cliente</label>
          <select className="input" value={filtro.cliente} onChange={(e) => setFiltro({ ...filtro, cliente: e.target.value })}>
            <option value="">Todos</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
        <div className="min-w-44">
          <label className="label">Persona</label>
          <select className="input" value={filtro.owner} onChange={(e) => setFiltro({ ...filtro, owner: e.target.value })}>
            <option value="">Todas</option>
            {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </div>
        <div className="min-w-44">
          <label className="label">Estado</label>
          <select className="input" value={filtro.estado} onChange={(e) => setFiltro({ ...filtro, estado: e.target.value as EstadoOperativo | '' })}>
            <option value="">Todos</option>
            {Object.keys(ESTADO_LABEL).map((s) => <option key={s} value={s}>{ESTADO_LABEL[s]}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-52">
          <label className="label">Buscar</label>
          <input className="input" placeholder="Requerimiento…" value={filtro.q} onChange={(e) => setFiltro({ ...filtro, q: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 text-sm pb-2">
          <input type="checkbox" checked={filtro.activos} onChange={(e) => setFiltro({ ...filtro, activos: e.target.checked })} /> Solo activos
        </label>
      </div>

      {error && <Alert tipo="error">{error}</Alert>}
      {loading && <div className="text-sm text-gray-500">Cargando…</div>}

      {!loading && vista === 'tabla' && (
        <div className="overflow-x-auto pb-4">
          <BacklogTable items={items} clientes={clientesVisibles.length ? clientesVisibles : clientes} usuarios={usuarios} onPatch={patch} onCrear={crear} />
        </div>
      )}
      {!loading && vista === 'kanban' && (
        <KanbanBoard items={items} clientes={clientes} usuarios={usuarios} onMover={(id, estado) => patch(id, { estado_operativo: estado })} />
      )}
    </div>
  );
}
