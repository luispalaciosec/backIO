'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { RequerimientoMetricas, Cliente, Usuario, Mesa, EstadoOperativo, ActualizarRequerimientoInput } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { Alert } from '@/components/ui/Alert';
import { BacklogTable } from '@/components/backlog/BacklogTable';
import { KanbanBoard } from '@/components/backlog/KanbanBoard';
import { MotivoReprogramacionModal } from '@/components/backlog/MotivoReprogramacion';
import { celebrar } from '@/lib/confetti';
import { ESTADO_LABEL } from '@/lib/format';
import { CAMPOS_ORDEN, ordenarRequerimientos, type CampoOrden, type Dir } from '@/lib/orden';

type Vista = 'tabla' | 'kanban';

export default function BacklogPage() {
  const [items, setItems] = useState<RequerimientoMetricas[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [horas, setHoras] = useState<Record<string, number>>({});
  const [proyectos, setProyectos] = useState<Record<string, string>>({});
  const [proyectoMesa, setProyectoMesa] = useState<Record<string, string | null>>({});
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [vista, setVista] = useState<Vista>('tabla');
  const [filtro, setFiltro] = useState({ cliente: '', owner: '', estado: '', activos: true, q: '', proyecto: '', mesa: '', planificacion: '' });
  const [orden, setOrden] = useState<{ campo: CampoOrden; dir: Dir }>({ campo: 'fecha_entrega', dir: 'asc' });
  const [panel, setPanel] = useState(false);
  const [reprog, setReprog] = useState<{ r: RequerimientoMetricas; fecha: string | null } | null>(null);
  const [celebracion, setCelebracion] = useState<{ n: number; titulos: string[] } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 4000); return () => clearTimeout(t); }, [aviso]);
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
    api<{ items: { id: string; nombre: string; mesa_id: string | null }[] }>('/proyectos').then((r) => { setProyectos(Object.fromEntries(r.items.map((p) => [p.id, p.nombre]))); setProyectoMesa(Object.fromEntries(r.items.map((p) => [p.id, p.mesa_id]))); }).catch(() => {});
    api<{ items: Mesa[] }>('/mesas').then((r) => setMesas(r.items.filter((m) => m.activa))).catch(() => {});
    api<{ por_requerimiento: Record<string, number> }>('/horas/resumen?dias=90').then((r) => setHoras(r.por_requerimiento)).catch(() => {});
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  // Celebración por lo completado desde la última visita (la mayoría se completa en Basecamp, sin pulsar nada aquí).
  // La marca de última visita es una preferencia de UI en localStorage, no un dato de negocio.
  useEffect(() => {
    const KEY = 'backio:backlog:ultima_visita';
    let desde: string | null = null;
    try { desde = localStorage.getItem(KEY); } catch { /* ignore */ }
    const ahora = new Date().toISOString();
    try { localStorage.setItem(KEY, ahora); } catch { /* ignore */ }
    if (!desde) return;
    api<{ items: RequerimientoMetricas[] }>('/requerimientos?estado=completado').then((r) => {
      const nuevos = r.items.filter((x) => x.completado_at && x.completado_at > (desde as string)).sort((a, b) => (b.completado_at ?? '').localeCompare(a.completado_at ?? ''));
      if (nuevos.length === 0) return;
      setCelebracion({ n: nuevos.length, titulos: nuevos.slice(0, 5).map((x) => x.titulo_interno) });
      void celebrar({ x: 0.5, y: 0.35 });
      if (nuevos.length >= 5) setTimeout(() => void celebrar({ x: 0.2, y: 0.4 }), 500);
      if (nuevos.length >= 10) setTimeout(() => void celebrar({ x: 0.8, y: 0.4 }), 900);
    }).catch(() => undefined);
  }, []);

  const me = useMe();
  const colaborador = me?.rol === 'colaborador';
  const CAMPOS_COLABORADOR = ['estado_operativo', 'fecha_entrega', 'entregable_urls', 'motivo_reprogramacion', 'observacion_reprogramacion', 'daily_fecha'];
  /** Un colaborador solo edita sus tareas y solo estado, fecha y entregables; el backend lo exige igual. */
  const puedeEditar = (r: RequerimientoMetricas) => !colaborador || (!!me?.usuario_id && r.owner_agencia.includes(me.usuario_id));

  async function patch(id: string, p: ActualizarRequerimientoInput) {
    // Cambiar la fecha de entrega exige motivo: se pide en un modal y se envía junto con la fecha.
    if (p.fecha_entrega !== undefined && !p.motivo_reprogramacion) {
      const r = items.find((x) => x.id === id);
      if (r && r.fecha_entrega && p.fecha_entrega !== r.fecha_entrega) { setReprog({ r, fecha: p.fecha_entrega }); return; }
    }
    if (colaborador) {
      const r = items.find((x) => x.id === id);
      if (r && !puedeEditar(r)) { setError('Solo puedes actualizar las tareas asignadas a ti.'); return; }
      const extra = Object.keys(p).filter((k) => !CAMPOS_COLABORADOR.includes(k));
      if (extra.length) { setError('Como colaborador solo puedes cambiar el estado, la fecha de entrega y los entregables.'); return; }
    }
    // Optimista: aplica en memoria y recarga en silencio.
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...(p as Partial<RequerimientoMetricas>) } : r)));
    try {
      const res = await api<{ basecamp_due_on?: 'ok' | 'error' | 'sin_todo' }>(`/requerimientos/${id}`, { method: 'PATCH', json: p });
      if (p.estado_operativo === 'completado') void celebrar();
      if (p.fecha_entrega !== undefined && res.basecamp_due_on === 'ok') setAviso('Fecha enviada a Basecamp ✓');
      if (p.fecha_entrega !== undefined && res.basecamp_due_on === 'error') setError('La fecha se guardó en BackIO pero Basecamp no la aceptó ahora; se reintenta en la reconciliación de 30 min.');
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
  const mesaDeCliente = Object.fromEntries(clientes.map((c) => [c.id, c.mesa_id]));
  /** Mesa del requerimiento: la del proyecto si tiene override, si no la del cliente. */
  const mesaDe = (r: RequerimientoMetricas) => (r.proyecto_id && proyectoMesa[r.proyecto_id]) || mesaDeCliente[r.cliente_id] || null;
  const itemsFiltrados = items.filter((r) => (!filtro.proyecto || r.proyecto_id === filtro.proyecto) && (!filtro.mesa || mesaDe(r) === filtro.mesa) && (!filtro.planificacion || (filtro.planificacion === 'fuera' ? r.planificacion !== 'planificado' : r.planificacion === filtro.planificacion)));
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
            {filtro.mesa && <Chip>Mesa {mesas.find((m) => m.id === filtro.mesa)?.nombre}</Chip>}
            {filtro.cliente && <Chip>{clientes.find((c) => c.id === filtro.cliente)?.nombre}</Chip>}
            {filtro.owner && <Chip>{nombres[filtro.owner]}</Chip>}
            {filtro.estado && <Chip>{ESTADO_LABEL[filtro.estado]}</Chip>}
            {filtro.proyecto && <Chip>{proyectos[filtro.proyecto]}</Chip>}
            {filtro.planificacion && <Chip>{filtro.planificacion === 'fuera' ? 'Fuera del weekly' : filtro.planificacion}</Chip>}
            {filtro.q && <Chip>“{filtro.q}”</Chip>}
            {!filtro.activos && <Chip>incluye completados</Chip>}
            <Chip tono="gris">{CAMPOS_ORDEN.find((c) => c.campo === orden.campo)?.label} {orden.dir === 'asc' ? '↑' : '↓'}</Chip>
          </span>
          <span className="text-xs text-gray-400 shrink-0">{itemsOrdenados.length} de {items.length}</span>
        </button>
        {panel && <div className="px-3 pb-3 flex flex-wrap gap-3 items-end border-t border-gray-100 pt-3">
        <div className="min-w-40">
          <label className="label">Mesa</label>
          <select className="input" value={filtro.mesa} onChange={(e) => setFiltro({ ...filtro, mesa: e.target.value, cliente: '' })}>
            <option value="">Todas</option>
            {mesas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>
        </div>
        <div className="min-w-44">
          <label className="label">Cliente</label>
          <select className="input" value={filtro.cliente} onChange={(e) => setFiltro({ ...filtro, cliente: e.target.value })}>
            <option value="">Todos</option>
            {clientes.filter((c) => !filtro.mesa || c.mesa_id === filtro.mesa).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
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
        <div className="min-w-40">
          <label className="label">Planificación</label>
          <select className="input" value={filtro.planificacion} onChange={(e) => setFiltro({ ...filtro, planificacion: e.target.value })}>
            <option value="">Todas</option><option value="fuera">Fuera del weekly (no planif. + urgente)</option><option value="no_planificado">No planificado</option><option value="urgente">Urgente</option><option value="planificado">Planificado</option>
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
          <button type="button" className="ml-auto link-action text-xs" onClick={() => { setFiltro({ cliente: '', owner: '', estado: '', activos: true, q: '', proyecto: '', mesa: '', planificacion: '' }); setOrden({ campo: 'fecha_entrega', dir: 'asc' }); }}>Limpiar</button>
        </div>
        </div>}
      </div>

      {error && <Alert tipo="error">{error}</Alert>}
      {aviso && <Alert tipo="ok">{aviso}</Alert>}
      {celebracion && (
        <div className="rounded-md border border-green-200 bg-green-50 text-green-900 px-4 py-3 text-sm flex items-start justify-between gap-3">
          <div>
            <div className="font-semibold">🎉 {celebracion.n === 1 ? '1 tarea completada' : `${celebracion.n} tareas completadas`} desde tu última visita</div>
            <div className="text-xs text-green-800 mt-1">{celebracion.titulos.join(' · ')}{celebracion.n > 5 ? ` · y ${celebracion.n - 5} más` : ''}</div>
          </div>
          <button className="btn-ghost text-xs py-1" onClick={() => setCelebracion(null)}>×</button>
        </div>
      )}
      {reprog && (
        <MotivoReprogramacionModal titulo={reprog.r.titulo_interno} fechaOriginal={reprog.r.fecha_entrega_original} fechaAnterior={reprog.r.fecha_entrega} fechaNueva={reprog.fecha} veces={reprog.r.veces_reprogramado}
          onCancelar={() => { setReprog(null); void cargar(true); }}
          onConfirmar={async (motivo, observacion) => { const { r, fecha } = reprog; setReprog(null); await patch(r.id, { fecha_entrega: fecha, motivo_reprogramacion: motivo, observacion_reprogramacion: observacion }); }} />
      )}
      {loading && <div className="text-sm text-gray-500">Cargando…</div>}

      {!loading && vista === 'tabla' && (
        <div className="overflow-x-auto pb-4">
          <BacklogTable items={itemsOrdenados} clientes={clientesVisibles.length ? clientesVisibles : clientes} usuarios={usuarios} onPatch={patch} onCrear={colaborador ? undefined : crear} horas={horas} puedeEditar={puedeEditar} proyectos={proyectos} onCambio={() => void cargar(true)} />
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
