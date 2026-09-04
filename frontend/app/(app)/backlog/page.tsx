'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { RequerimientoMetricas, Cliente, Usuario, EstadoOperativo, ActualizarRequerimientoInput } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { Alert } from '@/components/ui/Alert';
import { BacklogTable } from '@/components/backlog/BacklogTable';
import { KanbanBoard } from '@/components/backlog/KanbanBoard';
import { ESTADO_LABEL } from '@/lib/format';
import { CAMPOS_ORDEN, ordenarRequerimientos, type CampoOrden, type Dir } from '@/lib/orden';

type Vista = 'tabla' | 'kanban';

export default function BacklogPage() {
  const [items, setItems] = useState<RequerimientoMetricas[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [horas, setHoras] = useState<Record<string, number>>({});
  const [proyectos, setProyectos] = useState<Record<string, string>>({});
  const [vista, setVista] = useState<Vista>('tabla');
  const [filtro, setFiltro] = useState({ cliente: '', owner: '', estado: '', activos: true, q: '', proyecto: '' });
  const [orden, setOrden] = useState<{ campo: CampoOrden; dir: Dir }>({ campo: 'fecha_entrega', dir: 'asc' });
  const [panel, setPanel] = useState(false);
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
    api<{ items: { id: string; nombre: string }[] }>('/proyectos').then((r) => setProyectos(Object.fromEntries(r.items.map((p) => [p.id, p.nombre])))).catch(() => {});
    api<{ por_requerimiento: Record<string, number> }>('/horas/resumen?dias=90').then((r) => setHoras(r.por_requerimiento)).catch(() => {});
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const me = useMe();
  const colaborador = me?.rol === 'colaborador';
  const CAMPOS_COLABORADOR = ['estado_operativo', 'fecha_entrega', 'entregable_urls'];
  /** Un colaborador solo edita sus tareas y solo estado, fecha y entregables; el backend lo exige igual. */
  const puedeEditar = (r: RequerimientoMetricas) => !colaborador || (!!me?.usuario_id && r.owner_agencia.includes(me.usuario_id));

  async function patch(id: string, p: ActualizarRequerimientoInput) {
    if (colaborador) {
      const r = items.find((x) => x.id === id);
      if (r && !puedeEditar(r)) { setError('Solo puedes actualizar las tareas asignadas a ti.'); return; }
      const extra = Object.keys(p).filter((k) => !CAMPOS_COLABORADOR.includes(k));
      if (extra.length) { setError('Como colaborador solo puedes cambiar el estado, la fecha de entrega y los entregables.'); return; }
    }
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

  const nombres = Object.fromEntries(usuarios.map((u) => [u.id, u.nombre]));
  const itemsFiltrados = filtro.proyecto ? items.filter((r) => r.proyecto_id === filtro.proyecto) : items;
  const itemsOrdenados = ordenarRequerimientos(itemsFiltrados, orden.campo, orden.dir, { nombres, proyectos, horas });
  const proyectosDelFiltro = Object.entries(proyectos).filter(([id]) => items.some((r) => r.proyecto_id === id)).sort((a, b) => a[1].localeCompare(b[1]));
  const clientesVisibles = filtro.cliente ? clientes.filter((c) => c.id === filtro.cliente) : clientes.filter((c) => itemsOrdenados.some((r) => r.cliente_id === c.id));

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

      <div className="card">
        <button type="button" className="w-full flex items-center justify-between gap-3 px-3 py-2 text-sm" onClick={() => setPanel((v) => !v)}>
          <span className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{panel ? '▾' : '▸'} Buscar, filtrar y ordenar</span>
            {filtro.cliente && <Chip>{clientes.find((c) => c.id === filtro.cliente)?.nombre}</Chip>}
            {filtro.owner && <Chip>{nombres[filtro.owner]}</Chip>}
            {filtro.estado && <Chip>{ESTADO_LABEL[filtro.estado]}</Chip>}
            {filtro.proyecto && <Chip>{proyectos[filtro.proyecto]}</Chip>}
            {filtro.q && <Chip>“{filtro.q}”</Chip>}
            {!filtro.activos && <Chip>incluye completados</Chip>}
            <Chip tono="gris">{CAMPOS_ORDEN.find((c) => c.campo === orden.campo)?.label} {orden.dir === 'asc' ? '↑' : '↓'}</Chip>
          </span>
          <span className="text-xs text-gray-400 shrink-0">{itemsOrdenados.length} de {items.length}</span>
        </button>
        {panel && <div className="px-3 pb-3 flex flex-wrap gap-3 items-end border-t border-gray-100 pt-3">
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
        <div className="min-w-52">
          <label className="label">Proyecto</label>
          <select className="input" value={filtro.proyecto} onChange={(e) => setFiltro({ ...filtro, proyecto: e.target.value })}>
            <option value="">Todos</option>
            {proyectosDelFiltro.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-52">
          <label className="label">Buscar</label>
          <input className="input" placeholder="Requerimiento…" value={filtro.q} onChange={(e) => setFiltro({ ...filtro, q: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 text-sm pb-2">
          <input type="checkbox" checked={filtro.activos} onChange={(e) => setFiltro({ ...filtro, activos: e.target.checked })} /> Solo activos
        </label>
        <div className="w-full flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100 text-sm">
          <span className="text-xs uppercase tracking-wide text-gray-500">Ordenar por</span>
          <select className="input w-56" value={orden.campo} onChange={(e) => setOrden({ ...orden, campo: e.target.value as CampoOrden })}>
            {CAMPOS_ORDEN.map((c) => <option key={c.campo} value={c.campo}>{c.label}</option>)}
          </select>
          <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5">
            {(['asc', 'desc'] as Dir[]).map((d) => <button key={d} type="button" onClick={() => setOrden({ ...orden, dir: d })} className={`px-3 py-1 rounded ${orden.dir === d ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-100'}`}>{d === 'asc' ? '↑ Ascendente' : '↓ Descendente'}</button>)}
          </div>
          {[{ campo: 'atraso', dir: 'desc', label: 'Más atrasados' }, { campo: 'sin_movimiento', dir: 'desc', label: 'Más tiempo sin mover' }, { campo: 'fecha_entrega', dir: 'asc', label: 'Próximos a vencer' }, { campo: 'prioridad', dir: 'asc', label: 'Prioridad alta primero' }].map((a) => (
            <button key={a.label} type="button" className={`text-xs rounded-full border px-3 py-1 ${orden.campo === a.campo && orden.dir === a.dir ? 'border-brand text-brand bg-brand/5' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`} onClick={() => setOrden({ campo: a.campo as CampoOrden, dir: a.dir as Dir })}>{a.label}</button>
          ))}
          <button type="button" className="ml-auto link-action text-xs" onClick={() => { setFiltro({ cliente: '', owner: '', estado: '', activos: true, q: '', proyecto: '' }); setOrden({ campo: 'fecha_entrega', dir: 'asc' }); }}>Limpiar</button>
        </div>
        </div>}
      </div>

      {error && <Alert tipo="error">{error}</Alert>}
      {loading && <div className="text-sm text-gray-500">Cargando…</div>}

      {!loading && vista === 'tabla' && (
        <div className="overflow-x-auto pb-4">
          <BacklogTable items={itemsOrdenados} clientes={clientesVisibles.length ? clientesVisibles : clientes} usuarios={usuarios} onPatch={patch} onCrear={colaborador ? undefined : crear} horas={horas} puedeEditar={puedeEditar} proyectos={proyectos} />
        </div>
      )}
      {!loading && vista === 'kanban' && (
        <KanbanBoard items={itemsOrdenados} clientes={clientes} usuarios={usuarios} onMover={(id, estado) => patch(id, { estado_operativo: estado })} />
      )}
    </div>
  );
}

function Chip({ children, tono = 'brand' }: { children: React.ReactNode; tono?: 'brand' | 'gris' }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs ${tono === 'brand' ? 'bg-brand/10 text-brand' : 'bg-gray-100 text-gray-600'}`}>{children}</span>;
}
