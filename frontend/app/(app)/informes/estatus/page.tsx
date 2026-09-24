'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import type { Cliente, Usuario, RequerimientoMetricas, Bitacora } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';
import { EstadoChip } from '@/components/ui/EstadoChip';
import { fecha, fechaCorta, diaLocal, APROBACION_LABEL } from '@/lib/format';

type Fila = RequerimientoMetricas & { ultima_nota: Bitacora | null };

const lunes = (d: Date) => { const x = new Date(d); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return x.toISOString().slice(0, 10); };
const sumar = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Estatus por cliente para la reunión: tarea, responsable, estado y última observación. Reemplaza la hoja "Control de tareas". */
export default function EstatusPage() { return <Suspense><Estatus /></Suspense>; }

function Estatus() {
  const sp = useSearchParams(); const router = useRouter();
  const cliente = sp.get('cliente') ?? '';
  const desde = sp.get('desde') ?? lunes(new Date());
  const hasta = sp.get('hasta') ?? sumar(lunes(new Date()), 4);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [items, setItems] = useState<Fila[]>([]);
  const [proyectos, setProyectos] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [soloConNota, setSoloConNota] = useState(false);
  useEffect(() => {
    Promise.all([api<{ items: Cliente[] }>('/clientes'), api<{ items: Usuario[] }>('/usuarios'), api<{ items: { id: string; nombre: string }[] }>('/proyectos')])
      .then(([c, u, p]) => { setClientes(c.items); setUsuarios(u.items); setProyectos(Object.fromEntries(p.items.map((x) => [x.id, x.nombre]))); }).catch((e) => setError(e instanceof ApiError ? e.message : 'Error'));
  }, []);
  useEffect(() => {
    if (!cliente) { setItems([]); return; }
    setCargando(true); setError(null);
    api<{ items: Fila[] }>(`/requerimientos/estatus?cliente=${cliente}&desde=${desde}&hasta=${hasta}`).then((r) => setItems(r.items)).catch((e) => setError(e instanceof ApiError ? e.message : 'Error')).finally(() => setCargando(false));
  }, [cliente, desde, hasta]);
  const ir = (p: Record<string, string>) => { const q = new URLSearchParams({ cliente, desde, hasta, ...p }); router.replace(`/informes/estatus?${q.toString()}`); };
  const nombreU = (ids: string[]) => ids.map((id) => usuarios.find((u) => u.id === id)?.nombre ?? '').filter(Boolean).join(', ') || '—';
  const clienteNombre = clientes.find((c) => c.id === cliente)?.nombre ?? '';
  const grupos = useMemo(() => {
    const m = new Map<string, Fila[]>();
    for (const r of items.filter((r) => !soloConNota || r.ultima_nota)) { const k = r.proyecto_id ? proyectos[r.proyecto_id] ?? 'Proyecto' : 'Sin proyecto'; m.set(k, [...(m.get(k) ?? []), r]); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
  }, [items, proyectos, soloConNota]);
  const resumen = { total: items.length, hechas: items.filter((r) => r.estado_operativo === 'completado').length, atrasadas: items.filter((r) => r.dias_atraso > 0 && r.estado_operativo !== 'completado').length, cliente: items.filter((r) => r.estado_aprobacion === 'pendiente_cliente').length, conNota: items.filter((r) => r.ultima_nota).length };

  return (
    <div className="space-y-4 informe">
      <style>{`@media print { @page { size: A4 landscape; margin: 10mm; } aside, .no-print { display: none !important; } main { padding: 0 !important; } .informe { max-width: none !important; } section { break-inside: avoid; } .card { box-shadow: none !important; border: 1px solid #ddd; } }`}</style>
      <header className="no-print flex items-end justify-between gap-4 flex-wrap">
        <div><h1 className="text-2xl font-bold">Estatus por cliente</h1><p className="text-sm text-gray-500">La hoja de la reunión: cada tarea con su estado y la última observación de la bitácora. Imprime o guarda en PDF.</p></div>
        <div className="flex items-end gap-2 flex-wrap">
          <div><label className="label">Cliente</label><select className="input w-64" value={cliente} onChange={(e) => ir({ cliente: e.target.value })}><option value="">Elige un cliente…</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></div>
          <div><label className="label">Semana desde</label><input type="date" className="input" value={desde} onChange={(e) => ir({ desde: e.target.value, hasta: sumar(e.target.value, 4) })} /></div>
          <div><label className="label">hasta</label><input type="date" className="input" value={hasta} onChange={(e) => ir({ hasta: e.target.value })} /></div>
          <button className="btn-ghost" onClick={() => ir({ desde: sumar(desde, -7), hasta: sumar(hasta, -7) })} title="Semana anterior">‹</button>
          <button className="btn-ghost" onClick={() => ir({ desde: sumar(desde, 7), hasta: sumar(hasta, 7) })} title="Semana siguiente">›</button>
          <label className="flex items-center gap-2 text-sm pb-2"><input type="checkbox" checked={soloConNota} onChange={(e) => setSoloConNota(e.target.checked)} /> Solo con observación</label>
          <button className="btn-primary" disabled={!cliente} onClick={() => window.print()}>🖨 Imprimir / PDF</button>
        </div>
      </header>
      {error && <Alert tipo="error">{error}</Alert>}
      {!cliente && <p className="text-sm text-gray-400">Elige un cliente para armar el estatus.</p>}
      {cliente && (
        <>
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div><div className="text-xs uppercase tracking-wide text-gray-500">Control de tareas</div><h2 className="text-xl font-bold">{clienteNombre}</h2><div className="text-sm text-gray-500">Semana del {fecha(desde)} al {fecha(hasta)} · generado {fecha(new Date().toISOString().slice(0, 10))}</div></div>
            <div className="flex gap-3 text-sm">
              <div className="rounded-md border border-gray-200 px-3 py-2"><div className="text-xs text-gray-500">Tareas</div><b>{resumen.total}</b></div>
              <div className="rounded-md border border-gray-200 px-3 py-2"><div className="text-xs text-gray-500">Completadas</div><b className="text-green-700">{resumen.hechas}</b></div>
              <div className="rounded-md border border-gray-200 px-3 py-2"><div className="text-xs text-gray-500">Atrasadas</div><b className="text-red-700">{resumen.atrasadas}</b></div>
              <div className="rounded-md border border-gray-200 px-3 py-2"><div className="text-xs text-gray-500">Esperan al cliente</div><b className="text-amber-700">{resumen.cliente}</b></div>
              <div className="rounded-md border border-gray-200 px-3 py-2"><div className="text-xs text-gray-500">Con observación</div><b>{resumen.conNota}</b></div>
            </div>
          </div>
          {cargando && <p className="text-sm text-gray-400">Cargando…</p>}
          {grupos.map(([nombre, filas]) => (
            <section key={nombre} className="card overflow-hidden">
              <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 font-semibold flex justify-between"><span>{nombre}</span><span className="text-gray-400 font-normal">{filas.length}</span></div>
              <table className="w-full text-sm">
                <thead><tr><th className="th w-[28%]">Tarea</th><th className="th">Responsable</th><th className="th">Entrega</th><th className="th">Estado</th><th className="th">Aprobación</th><th className="th w-[34%]">Observación</th></tr></thead>
                <tbody>
                  {filas.map((r) => (
                    <tr key={r.id} className={r.estado_operativo === 'completado' ? 'opacity-70' : ''}>
                      <td className="td">{r.titulo_interno}{r.bloque_nombre && <div className="text-xs text-gray-400">{r.bloque_nombre}</div>}</td>
                      <td className="td text-gray-700">{nombreU(r.owner_agencia)}</td>
                      <td className={`td whitespace-nowrap ${r.dias_atraso > 0 && r.estado_operativo !== 'completado' ? 'text-red-700 font-semibold' : ''}`}>{fecha(r.fecha_entrega)}{r.dias_atraso > 0 && r.estado_operativo !== 'completado' ? ` · ${r.dias_atraso} d` : ''}</td>
                      <td className="td"><EstadoChip estado={r.estado_operativo} /></td>
                      <td className="td text-xs">{r.estado_aprobacion === 'no_aplica' ? '' : APROBACION_LABEL[r.estado_aprobacion] ?? r.estado_aprobacion}</td>
                      <td className="td text-xs whitespace-pre-wrap">{r.ultima_nota ? <><span className="text-gray-400">{fechaCorta(diaLocal(r.ultima_nota.created_at))} · </span>{r.ultima_nota.nota}</> : <span className="text-gray-300">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
          {!cargando && items.length === 0 && <p className="text-sm text-gray-400">Sin tareas activas ni completadas en esa semana.</p>}
          <p className="text-xs text-gray-400">Generado por BackIO · La observación es la última nota de la bitácora hasta el {fecha(hasta)}.</p>
        </>
      )}
    </div>
  );
}
