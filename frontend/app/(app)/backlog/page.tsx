'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { RequerimientoMetricas, Cliente, Usuario, EstadoOperativo } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { EstadoChip } from '@/components/ui/EstadoChip';
import { Alert } from '@/components/ui/Alert';
import { fecha, ESTADO_LABEL, APROBACION_LABEL } from '@/lib/format';

const ESTADOS = Object.keys(ESTADO_LABEL) as EstadoOperativo[];

export default function BacklogPage() {
  const [items, setItems] = useState<RequerimientoMetricas[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [filtro, setFiltro] = useState({ cliente: '', owner: '', estado: '', activos: true, q: '' });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const cargar = useCallback(async () => {
    setLoading(true);
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

  async function cambiarEstado(r: RequerimientoMetricas, estado: EstadoOperativo) {
    try {
      await api(`/requerimientos/${r.id}`, { method: 'PATCH', json: { estado_operativo: estado } });
      await cargar();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo actualizar');
    }
  }

  const nombre = (id?: string) => usuarios.find((u) => u.id === id)?.nombre ?? '—';
  const cliente = (id: string) => clientes.find((c) => c.id === id)?.nombre ?? '—';

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Backlog priorizado</h1>
          <p className="text-sm text-gray-500">{items.length} requerimientos · <span className="font-medium">días sin movimiento</span> es la columna que importa</p>
        </div>
        <Link href="/proyectos/nuevo" className="btn-primary">+ Nuevo proyecto</Link>
      </header>

      <div className="card p-3 flex flex-wrap gap-3 items-end">
        <div className="min-w-40">
          <label className="label">Cliente</label>
          <select className="input" value={filtro.cliente} onChange={(e) => setFiltro({ ...filtro, cliente: e.target.value })}>
            <option value="">Todos</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
        <div className="min-w-40">
          <label className="label">Responsable</label>
          <select className="input" value={filtro.owner} onChange={(e) => setFiltro({ ...filtro, owner: e.target.value })}>
            <option value="">Todos</option>
            {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </div>
        <div className="min-w-40">
          <label className="label">Estado</label>
          <select className="input" value={filtro.estado} onChange={(e) => setFiltro({ ...filtro, estado: e.target.value })}>
            <option value="">Todos</option>
            {ESTADOS.map((s) => <option key={s} value={s}>{ESTADO_LABEL[s]}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-48">
          <label className="label">Buscar</label>
          <input className="input" placeholder="Título interno…" value={filtro.q} onChange={(e) => setFiltro({ ...filtro, q: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 text-sm pb-2">
          <input type="checkbox" checked={filtro.activos} onChange={(e) => setFiltro({ ...filtro, activos: e.target.checked })} /> Solo activos
        </label>
      </div>

      {error && <Alert tipo="error">{error}</Alert>}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[960px]">
          <thead>
            <tr>
              <th className="th">Cliente</th>
              <th className="th">Requerimiento</th>
              <th className="th">Responsable</th>
              <th className="th">Prioridad</th>
              <th className="th">Entrega</th>
              <th className="th">Estado</th>
              <th className="th">Aprobación</th>
              <th className="th text-right">Atraso</th>
              <th className="th text-right">Sin mov.</th>
              <th className="th">Cliente ve</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td className="td text-gray-500" colSpan={10}>Cargando…</td></tr>}
            {!loading && items.length === 0 && <tr><td className="td text-gray-500" colSpan={10}>Sin requerimientos con estos filtros.</td></tr>}
            {items.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="td whitespace-nowrap">{cliente(r.cliente_id)}</td>
                <td className="td">
                  <div className="font-medium">{r.titulo_interno}</div>
                  <div className="text-xs text-gray-500">{r.bloque_nombre ?? r.tipo_trabajo}{r.proyecto_id && <> · <Link className="underline" href={`/proyectos/${r.proyecto_id}`}>proyecto</Link></>}{r.basecamp_url && <> · <a className="underline" href={r.basecamp_url} target="_blank" rel="noreferrer">Basecamp</a></>}</div>
                </td>
                <td className="td whitespace-nowrap">{nombre(r.owner_agencia[0])}</td>
                <td className="td capitalize">{r.prioridad}</td>
                <td className="td whitespace-nowrap">{fecha(r.fecha_entrega)}{r.veces_reprogramado > 0 && <span className="ml-1 text-xs text-amber-600">↻{r.veces_reprogramado}</span>}</td>
                <td className="td">
                  <select
                    className="text-xs border border-gray-200 rounded px-1 py-0.5 bg-white"
                    value={r.estado_operativo}
                    onChange={(e) => cambiarEstado(r, e.target.value as EstadoOperativo)}
                    aria-label="Cambiar estado"
                  >
                    {ESTADOS.map((s) => <option key={s} value={s} disabled={s === 'completado' && !!r.basecamp_todo_id}>{ESTADO_LABEL[s]}</option>)}
                  </select>
                  <div className="mt-1"><EstadoChip estado={r.estado_operativo} /></div>
                </td>
                <td className="td text-xs">{APROBACION_LABEL[r.estado_aprobacion]}</td>
                <td className={`td text-right tabular-nums ${r.dias_atraso > 0 ? 'text-red-600 font-semibold' : ''}`}>{r.dias_atraso || ''}</td>
                <td className={`td text-right tabular-nums ${r.dias_sin_movimiento > 14 ? 'text-amber-600 font-semibold' : ''}`}>{r.dias_sin_movimiento}</td>
                <td className="td text-xs">{r.visible_cliente ? <span title={r.etiqueta_cliente ?? ''}>👁 {r.etiqueta_cliente}</span> : <span className="text-gray-400">oculto</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
