'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Proyecto, Cliente, Mesa, Usuario } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { AvanceBar } from '@/components/ui/AvanceBar';
import { EstadoChip } from '@/components/ui/EstadoChip';
import { Alert } from '@/components/ui/Alert';
import { fecha, ESTADO_LABEL } from '@/lib/format';

type Fila = Proyecto & { avance: number; cliente_nombre: string };
type Orden = 'entrega' | 'inicio' | 'avance' | 'nombre' | 'cliente' | 'actualizado' | 'estado';
const ORDENES: { v: Orden; label: string }[] = [
  { v: 'entrega', label: 'Fecha de entrega' }, { v: 'inicio', label: 'Fecha de inicio' }, { v: 'avance', label: 'Avance' },
  { v: 'nombre', label: 'Nombre' }, { v: 'cliente', label: 'Cliente' }, { v: 'estado', label: 'Estado' }, { v: 'actualizado', label: 'Última actualización' },
];
const ESTADO_ORDEN: Record<string, number> = { bloqueado: 0, en_ejecucion: 1, en_revision: 2, priorizado: 3, reprogramado: 4, backlog: 5, completado: 6, cancelado: 7 };

export default function ProyectosPage() {
  const [items, setItems] = useState<Fila[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [f, setF] = useState({ q: '', cliente: '', estado: '', mesa: '', ejecutiva: '', portal: '', activos: true });
  const [orden, setOrden] = useState<Orden>('entrega');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [vista, setVista] = useState<'tarjetas' | 'lista'>('tarjetas');

  useEffect(() => {
    Promise.all([api<{ items: Fila[] }>('/proyectos'), api<{ items: Cliente[] }>('/clientes?todos=1'), api<{ items: Mesa[] }>('/mesas'), api<{ items: Usuario[] }>('/usuarios')])
      .then(([p, c, m, u]) => { setItems(p.items); setClientes(c.items); setMesas(m.items); setUsuarios(u.items); })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Error cargando proyectos'))
      .finally(() => setCargando(false));
  }, []);

  const mesaDeCliente = useMemo(() => Object.fromEntries(clientes.map((c) => [c.id, c.mesa_id])), [clientes]);
  const nombreU = (id: string | null) => usuarios.find((u) => u.id === id)?.nombre ?? '';

  const visibles = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    const out = items.filter((p) => {
      if (f.activos && (p.estado === 'completado' || p.estado === 'cancelado')) return false;
      if (f.cliente && p.cliente_id !== f.cliente) return false;
      if (f.estado && p.estado !== f.estado) return false;
      if (f.mesa && (p.mesa_id ?? mesaDeCliente[p.cliente_id]) !== f.mesa) return false;
      if (f.ejecutiva && p.owner_ejecutiva !== f.ejecutiva) return false;
      if (f.portal === 'activo' && !p.portal_activo) return false;
      if (f.portal === 'inactivo' && p.portal_activo) return false;
      if (q && !`${p.nombre} ${p.cliente_nombre}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const key = (p: Fila): string | number => {
      switch (orden) {
        case 'entrega': return p.fecha_entrega;
        case 'inicio': return p.fecha_inicio;
        case 'avance': return p.avance;
        case 'nombre': return p.nombre.toLowerCase();
        case 'cliente': return `${p.cliente_nombre} ${p.nombre}`.toLowerCase();
        case 'estado': return ESTADO_ORDEN[p.estado] ?? 9;
        case 'actualizado': return p.updated_at;
      }
    };
    const m = dir === 'asc' ? 1 : -1;
    return out.sort((a, b) => { const ka = key(a), kb = key(b); return (ka < kb ? -1 : ka > kb ? 1 : 0) * m; });
  }, [items, f, orden, dir, mesaDeCliente]);

  const resumen = useMemo(() => ({
    activos: items.filter((p) => p.estado !== 'completado' && p.estado !== 'cancelado').length,
    completados: items.filter((p) => p.estado === 'completado').length,
    atrasados: items.filter((p) => p.estado !== 'completado' && p.estado !== 'cancelado' && p.fecha_entrega < new Date().toISOString().slice(0, 10)).length,
  }), [items]);
  const hoy = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Proyectos</h1>
          <p className="text-sm text-gray-500">{items.length} proyectos · {resumen.activos} activos · {resumen.completados} completados{resumen.atrasados ? <> · <span className="text-red-700 font-medium">{resumen.atrasados} con entrega vencida</span></> : null}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5 text-sm">
            {(['tarjetas', 'lista'] as const).map((v) => <button key={v} onClick={() => setVista(v)} className={`px-3 py-1.5 rounded ${vista === v ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-100'}`}>{v === 'tarjetas' ? 'Tarjetas' : 'Lista'}</button>)}
          </div>
          <Link href="/proyectos/nuevo" className="btn-primary">+ Nuevo proyecto</Link>
        </div>
      </header>

      <div className="card p-3 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-56"><label className="label">Buscar</label><input className="input" placeholder="Nombre del proyecto o cliente…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
        <div className="min-w-44"><label className="label">Cliente</label><select className="input" value={f.cliente} onChange={(e) => setF({ ...f, cliente: e.target.value })}><option value="">Todos</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></div>
        <div className="min-w-36"><label className="label">Mesa</label><select className="input" value={f.mesa} onChange={(e) => setF({ ...f, mesa: e.target.value })}><option value="">Todas</option>{mesas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select></div>
        <div className="min-w-40"><label className="label">Ejecutiva</label><select className="input" value={f.ejecutiva} onChange={(e) => setF({ ...f, ejecutiva: e.target.value })}><option value="">Todas</option>{usuarios.filter((u) => u.activo).map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></div>
        <div className="min-w-40"><label className="label">Estado</label><select className="input" value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })}><option value="">Todos</option>{Object.keys(ESTADO_LABEL).map((s) => <option key={s} value={s}>{ESTADO_LABEL[s]}</option>)}</select></div>
        <div className="min-w-32"><label className="label">Portal</label><select className="input" value={f.portal} onChange={(e) => setF({ ...f, portal: e.target.value })}><option value="">Todos</option><option value="activo">Activo</option><option value="inactivo">Inactivo</option></select></div>
        <label className="flex items-center gap-2 text-sm pb-2"><input type="checkbox" checked={f.activos} onChange={(e) => setF({ ...f, activos: e.target.checked })} /> Solo activos</label>
        <div className="w-full flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100 text-sm">
          <span className="text-xs uppercase tracking-wide text-gray-500">Ordenar por</span>
          <select className="input w-52" value={orden} onChange={(e) => setOrden(e.target.value as Orden)}>{ORDENES.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select>
          <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5">
            {(['asc', 'desc'] as const).map((d) => <button key={d} type="button" onClick={() => setDir(d)} className={`px-3 py-1 rounded ${dir === d ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-100'}`}>{d === 'asc' ? '↑ Ascendente' : '↓ Descendente'}</button>)}
          </div>
          {[{ o: 'entrega', d: 'asc', label: 'Próximos a entregar' }, { o: 'avance', d: 'asc', label: 'Menos avanzados' }, { o: 'actualizado', d: 'desc', label: 'Recién actualizados' }].map((a) => (
            <button key={a.label} type="button" className={`text-xs rounded-full border px-3 py-1 ${orden === a.o && dir === a.d ? 'border-brand text-brand bg-brand/5' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`} onClick={() => { setOrden(a.o as Orden); setDir(a.d as 'asc' | 'desc'); }}>{a.label}</button>
          ))}
          <span className="ml-auto text-xs text-gray-400">{visibles.length} de {items.length}</span>
        </div>
      </div>

      {error && <Alert tipo="error">{error}</Alert>}
      {cargando && <p className="text-sm text-gray-400">Cargando proyectos…</p>}
      {!cargando && visibles.length === 0 && <div className="card p-6 text-gray-500">{items.length === 0 ? 'Aún no hay proyectos. Crea el primero con el Builder.' : 'Ningún proyecto coincide con los filtros.'}</div>}

      {vista === 'tarjetas' ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibles.map((p) => {
            const vencido = p.estado !== 'completado' && p.estado !== 'cancelado' && p.fecha_entrega < hoy;
            return (
              <Link key={p.id} href={`/proyectos/${p.id}`} className="card p-4 hover:border-brand transition space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs text-gray-500 truncate">{p.cliente_nombre}{p.owner_ejecutiva ? ` · ${nombreU(p.owner_ejecutiva)}` : ''}</div>
                    <div className="font-semibold">{p.nombre}</div>
                  </div>
                  <EstadoChip estado={p.estado} />
                </div>
                <AvanceBar valor={p.avance} alto="h-2" />
                <div className="flex justify-between text-xs text-gray-500">
                  <span className={vencido ? 'text-red-700 font-medium' : ''}>Entrega {fecha(p.fecha_entrega)}{vencido ? ' · vencida' : ''}</span>
                  <span>{p.portal_activo ? 'Portal activo' : 'Portal inactivo'}{p.sync_estado === 'incompleto' && ' · ⚠ sync Basecamp'}</span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead><tr><th className="th">Proyecto</th><th className="th">Cliente</th><th className="th">Ejecutiva</th><th className="th">Estado</th><th className="th">Inicio</th><th className="th">Entrega</th><th className="th w-48">Avance</th><th className="th">Portal</th></tr></thead>
            <tbody>
              {visibles.map((p) => {
                const vencido = p.estado !== 'completado' && p.estado !== 'cancelado' && p.fecha_entrega < hoy;
                return (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="td font-medium"><Link href={`/proyectos/${p.id}`} className="hover:text-brand">{p.nombre}</Link>{p.sync_estado === 'incompleto' && <span className="ml-1 text-amber-600" title="Sync Basecamp incompleto">⚠</span>}</td>
                    <td className="td text-gray-600">{p.cliente_nombre}</td>
                    <td className="td text-gray-600">{nombreU(p.owner_ejecutiva)}</td>
                    <td className="td"><EstadoChip estado={p.estado} /></td>
                    <td className="td whitespace-nowrap text-gray-500">{fecha(p.fecha_inicio)}</td>
                    <td className={`td whitespace-nowrap ${vencido ? 'text-red-700 font-medium' : ''}`}>{fecha(p.fecha_entrega)}</td>
                    <td className="td"><div className="flex items-center gap-2"><div className="flex-1"><AvanceBar valor={p.avance} alto="h-2" /></div></div></td>
                    <td className="td text-xs text-gray-500">{p.portal_activo ? 'Activo' : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
