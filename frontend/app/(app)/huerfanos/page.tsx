'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Cliente, Usuario, RequerimientoMetricas } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';
import { CeldaSelect, CeldaOwners } from '@/components/backlog/Celdas';
import { COLOR_PRIORIDAD, COLOR_TIPO, COLOR_APROBACION } from '@/components/backlog/colores';
import { PRIORIDAD_LABEL, TIPO_LABEL, APROBACION_LABEL, fecha, haceCuanto } from '@/lib/format';

type Entrada = Pick<RequerimientoMetricas, 'id' | 'titulo_interno' | 'cliente_id' | 'proyecto_id' | 'bloque_nombre' | 'owner_agencia' | 'fecha_entrega' | 'estado_operativo' | 'prioridad' | 'tipo_trabajo' | 'piezas' | 'estado_aprobacion' | 'basecamp_url'> & { entrada_at: string; lista: string | null; creador: string | null };
const PRIOS = Object.keys(PRIORIDAD_LABEL); const TIPOS = Object.keys(TIPO_LABEL); const APROB = Object.keys(APROBACION_LABEL);

/**
 * Entradas desde Basecamp: lo que el equipo creó a mano en Basecamp ya está en BackIO (entra solo cada 30 min).
 * Aquí la ejecutiva completa lo que Basecamp no sabe y marca la entrada como revisada.
 */
export default function EntradasBasecampPage() {
  const [items, setItems] = useState<Entrada[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [filtroCliente, setFiltroCliente] = useState('');
  const cargar = () => Promise.all([api<{ items: Entrada[] }>('/huerfanos/entradas?dias=14'), api<{ items: Cliente[] }>('/clientes?todos=1'), api<{ items: Usuario[] }>('/usuarios')])
    .then(([e, c, u]) => { setItems(e.items); setClientes(c.items); setUsuarios(u.items); }).catch((e) => setError(e instanceof ApiError ? e.message : 'Error')).finally(() => setCargando(false));
  useEffect(() => { void cargar(); }, []);
  const cliente = (id: string) => clientes.find((c) => c.id === id)?.nombre ?? '';

  async function patch(e: Entrada, p: Partial<Entrada>) {
    setError(null);
    setItems((xs) => xs.map((x) => (x.id === e.id ? { ...x, ...p } : x)));
    try { await api(`/requerimientos/${e.id}`, { method: 'PATCH', json: p }); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'No se pudo actualizar'); await cargar(); }
  }
  async function revisada(e: Entrada) {
    setError(null);
    try { await api(`/huerfanos/entradas/${e.id}/revisada`, { method: 'POST' }); setItems((xs) => xs.filter((x) => x.id !== e.id)); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Error'); }
  }
  const visibles = items.filter((e) => !filtroCliente || e.cliente_id === filtroCliente);
  const porCliente = items.reduce<Record<string, number>>((acc, e) => { acc[e.cliente_id] = (acc[e.cliente_id] ?? 0) + 1; return acc; }, {});
  const sinResp = visibles.filter((e) => e.owner_agencia.length === 0).length;

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Entradas desde Basecamp</h1>
          <p className="text-sm text-gray-500">Lo que el equipo crea en Basecamp entra solo a BackIO cada 30 minutos (listas → proyectos, grupos → bloques, to-dos → tareas). Aquí completas lo que Basecamp no sabe y marcas la entrada como revisada.</p>
        </div>
        <select className="input w-64" value={filtroCliente} onChange={(e) => setFiltroCliente(e.target.value)}>
          <option value="">Todos los clientes ({items.length})</option>
          {Object.entries(porCliente).sort((a, b) => b[1] - a[1]).map(([id, n]) => <option key={id} value={id}>{cliente(id)} ({n})</option>)}
        </select>
      </header>
      {error && <Alert tipo="error">{error}</Alert>}
      {sinResp > 0 && <Alert tipo="warn">{sinResp === 1 ? 'Una entrada no tiene responsable' : `${sinResp} entradas no tienen responsable`}. Sin responsable no pueden entrar al daily: asígnalo aquí mismo.</Alert>}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm">
          <thead><tr><th className="th">Entró</th><th className="th">Cliente · lista</th><th className="th">Tarea</th><th className="th">Responsables</th><th className="th">Entrega</th><th className="th w-28">Prioridad</th><th className="th w-28">Tipo</th><th className="th w-36">Aprobación</th><th className="th w-20">Piezas</th><th className="th"></th></tr></thead>
          <tbody>
            {visibles.map((e) => (
              <tr key={e.id} className={e.owner_agencia.length === 0 ? 'bg-red-50/40' : ''}>
                <td className="td whitespace-nowrap text-gray-500" title={e.entrada_at}>{haceCuanto(e.entrada_at)}{e.creador && <div className="text-xs text-gray-400">por {e.creador}</div>}</td>
                <td className="td"><div className="font-medium">{cliente(e.cliente_id)}</div><div className="text-xs text-gray-500">{e.lista ?? '—'}{e.bloque_nombre ? ` › ${e.bloque_nombre}` : ''}</div></td>
                <td className="td">{e.titulo_interno}{e.basecamp_url && <a className="ml-2 text-xs font-bold text-emerald-700" href={e.basecamp_url} target="_blank" rel="noreferrer" title="Abrir en Basecamp">Bc↗</a>}{e.proyecto_id && <Link className="ml-2 text-xs text-gray-400 hover:text-brand" href={`/proyectos/${e.proyecto_id}`}>proyecto ↗</Link>}</td>
                <td className="td"><div className="w-40"><CeldaOwners ids={e.owner_agencia} usuarios={usuarios} onChange={(ids) => patch(e, { owner_agencia: ids })} /></div></td>
                <td className="td whitespace-nowrap">{fecha(e.fecha_entrega)}</td>
                <td className="td p-0"><CeldaSelect valor={e.prioridad} opciones={PRIOS} colores={COLOR_PRIORIDAD} labels={PRIORIDAD_LABEL} onChange={(v) => patch(e, { prioridad: v as Entrada['prioridad'] })} /></td>
                <td className="td p-0"><CeldaSelect valor={e.tipo_trabajo} opciones={TIPOS} colores={COLOR_TIPO} labels={TIPO_LABEL} onChange={(v) => patch(e, { tipo_trabajo: v as Entrada['tipo_trabajo'] })} /></td>
                <td className="td p-0"><CeldaSelect valor={e.estado_aprobacion} opciones={APROB} colores={COLOR_APROBACION} labels={APROBACION_LABEL} onChange={(v) => patch(e, { estado_aprobacion: v as Entrada['estado_aprobacion'] })} /></td>
                <td className="td p-0"><input className="h-9 w-full bg-transparent text-sm text-center tabular-nums placeholder:text-amber-500 focus:outline-none focus:ring-2 focus:ring-brand/40" inputMode="numeric" placeholder="¿piezas?" defaultValue={e.piezas || ''} onBlur={(ev) => { const n = Math.max(0, Math.floor(Number(ev.target.value) || 0)); if (n !== (e.piezas ?? 0)) void patch(e, { piezas: n }); }} /></td>
                <td className="td whitespace-nowrap"><button className="btn-success px-3 py-1 text-xs" onClick={() => revisada(e)} title="Ya completaste lo que faltaba; sale de esta bandeja">Revisada ✓</button></td>
              </tr>
            ))}
            {!cargando && visibles.length === 0 && <tr><td className="td text-gray-400" colSpan={10}>Nada pendiente de revisar. Lo que el equipo cree en Basecamp aparecerá aquí en menos de 30 minutos.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">Los cambios se guardan al momento en el backlog. «Revisada» solo saca la fila de esta bandeja; la tarea sigue en el backlog y en su proyecto. Las entradas se muestran hasta 14 días.</p>
    </div>
  );
}
