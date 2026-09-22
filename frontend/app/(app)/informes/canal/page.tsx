'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Cliente } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';
import { Tarjeta, BarrasDobles, Lineas, Apiladas, Pastel, BarraEstado, type Serie } from '@/components/informe/Graficas';

interface Informe { titulo: string; desde: string; hasta: string; generado_at: string; canales: { cliente_id: string; nombre: string; color: string }[]; totales: { piezas: number; tareas: number; completadas: number; aprobadas: number; pendiente_cliente: number; pct_listo: number }; por_mes: { mes: string; etiqueta: string; piezas: number; tareas: number; por_canal: Record<string, { piezas: number; tareas: number }> }[]; por_semana: { semana: string; etiqueta: string; piezas: number; tareas: number }[]; estado: { completadas: number; en_proceso: number; otras: number }; aprobacion: { aprobado: number; pendiente_cliente: number; pendiente_interno: number; otros: number }; prioridad: { alta: number; media: number; baja: number }; sin_piezas: number }
interface Grupo { id: string; nombre: string; cliente_ids: string[] }
const PIEZAS: Serie = { id: 'p', nombre: 'Piezas', color: '#4f8df5' }; const RECUENTO: Serie = { id: 'r', nombre: 'Recuento', color: '#f5c518' };
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export default function InformeCanalPage() {
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [titulo, setTitulo] = useState('');
  const [desde, setDesde] = useState('2026-09-01');
  const [hasta, setHasta] = useState(hoy());
  const [d, setD] = useState<Informe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { Promise.all([api<{ items: Grupo[] }>('/ia/canal/grupos'), api<{ items: Cliente[] }>('/clientes')]).then(([g, c]) => { setGrupos(g.items); setClientes(c.items); if (g.items[0]) { setSel(g.items[0].cliente_ids); setTitulo(g.items[0].nombre); } }).catch((e) => setError(e instanceof ApiError ? e.message : 'Error')); }, []);
  const generar = useCallback(async () => { if (!sel.length) return; setBusy(true); setError(null); try { setD(await api<Informe>(`/ia/canal?clientes=${sel.join(',')}&desde=${desde}&hasta=${hasta}&titulo=${encodeURIComponent(titulo)}`)); } catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); } setBusy(false); }, [sel, desde, hasta, titulo]);
  useEffect(() => { void generar(); }, [generar]);
  const series: Serie[] = d ? d.canales.map((c) => ({ id: c.cliente_id, nombre: c.nombre, color: c.color })) : [];
  const apil = (k: 'piezas' | 'tareas') => (d?.por_mes ?? []).map((m) => ({ etiqueta: m.etiqueta, total: m[k], valores: Object.fromEntries(Object.entries(m.por_canal).map(([id, v]) => [id, v[k]])) }));
  const totalCanal = (k: 'piezas' | 'tareas') => series.map((s) => ({ nombre: s.nombre, color: s.color, valor: (d?.por_mes ?? []).reduce((acc, m) => acc + (m.por_canal[s.id]?.[k] ?? 0), 0) }));
  const fechaGen = d ? new Date(d.generado_at).toLocaleString('es-EC', { timeZone: 'America/Guayaquil', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

  return (
    <div className="space-y-4">
      <style>{`@media print { @page { size: A4 portrait; margin: 10mm; } aside, header.no-print, .no-print { display: none !important; } main { padding: 0 !important; } .informe { max-width: none !important; } section { break-inside: avoid; } }`}</style>
      <header className="no-print flex items-end justify-between gap-4 flex-wrap">
        <div><h1 className="text-2xl font-bold">Informe por canal</h1><p className="text-sm text-gray-500">Piezas y tareas por mes, semana y canal. Un canal = un cliente. Se calcula desde el campo <b>Piezas</b> del backlog. <Link href="/informes" className="link-action">← Informes mensuales</Link></p></div>
        <div className="flex items-end gap-2 flex-wrap">
          <div><label className="label">Grupo / preset</label><select className="input w-64" value={grupos.find((g) => g.cliente_ids.join(',') === sel.join(','))?.id ?? ''} onChange={(e) => { const g = grupos.find((x) => x.id === e.target.value); if (g) { setSel(g.cliente_ids); setTitulo(g.nombre); } }}><option value="">Selección manual…</option>{grupos.map((g) => <option key={g.id} value={g.id}>{g.nombre}</option>)}</select></div>
          <div><label className="label">Desde</label><input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
          <div><label className="label">Hasta</label><input className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
          <button className="btn-primary" disabled={busy || !d} onClick={() => window.print()}>⬇ Descargar PDF</button>
        </div>
      </header>
      <details className="no-print card p-3 text-sm"><summary className="cursor-pointer font-medium">Clientes incluidos ({sel.length}) y título</summary>
        <div className="mt-2 flex flex-wrap gap-2">{clientes.map((c) => <label key={c.id} className={`rounded-full border px-3 py-1 cursor-pointer ${sel.includes(c.id) ? 'border-brand bg-brand/5 text-brand' : 'border-gray-200'}`}><input type="checkbox" className="hidden" checked={sel.includes(c.id)} onChange={(e) => setSel(e.target.checked ? [...sel, c.id] : sel.filter((x) => x !== c.id))} />{c.nombre}</label>)}</div>
        <input className="input mt-2" placeholder="Título del informe" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
      </details>
      {error && <Alert tipo="error">{error}</Alert>}
      {d && d.sin_piezas > 0 && <div className="no-print"><Alert tipo="warn">{d.sin_piezas} {d.sin_piezas === 1 ? 'tarea del periodo no tiene' : 'tareas del periodo no tienen'} piezas registradas: las ejecutivas deben llenar la columna Piezas en el backlog para que este informe sea completo.</Alert></div>}
      {busy && !d && <p className="text-sm text-gray-400">Calculando…</p>}
      {d && (
        <div className="informe max-w-[1100px] rounded-lg p-4 space-y-3" style={{ background: '#f6f7fb' }}>
          <div className="flex items-baseline justify-between"><h2 className="text-xl font-semibold text-gray-800">{d.titulo}</h2><span className="text-xs text-gray-500">{fechaGen}</span></div>
          <div className="grid gap-3" style={{ gridTemplateColumns: '3fr 1fr 1fr' }}>
            <Tarjeta titulo="Estado General de las tareas"><BarraEstado aprobado={d.aprobacion.aprobado} revision={d.aprobacion.pendiente_cliente} pctListo={d.totales.pct_listo} /></Tarjeta>
            <Tarjeta titulo="# Total de Piezas"><div className="text-4xl font-medium text-center py-3 text-gray-800">{d.totales.piezas}</div></Tarjeta>
            <Tarjeta titulo="# Total de Tareas"><div className="text-4xl font-medium text-center py-3 text-gray-800">{d.totales.tareas}</div></Tarjeta>
          </div>
          <Tarjeta titulo="Conteo de Piezas y Tareas generadas por mes"><BarrasDobles datos={d.por_mes.map((m) => ({ etiqueta: m.etiqueta, a: m.piezas, b: m.tareas }))} a={PIEZAS} b={RECUENTO} /></Tarjeta>
          <Tarjeta titulo="Cantidad de Piezas y Tareas entregadas por semana"><Lineas datos={d.por_semana.map((s) => ({ etiqueta: s.etiqueta, a: s.piezas, b: s.tareas }))} a={PIEZAS} b={RECUENTO} /></Tarjeta>
          <div className="grid gap-3" style={{ gridTemplateColumns: '1.4fr 1.4fr 1fr' }}>
            <Tarjeta titulo="Conteo Mensual de Piezas por Canal"><Apiladas datos={apil('piezas')} series={series} modo="valor" ejeY="Piezas" /></Tarjeta>
            <Tarjeta titulo="% Mensual de Piezas por Canal"><Apiladas datos={apil('piezas')} series={series} modo="pct" ejeY="Piezas" /></Tarjeta>
            <Tarjeta titulo="% Total de Piezas por Canal"><Pastel partes={totalCanal('piezas')} /></Tarjeta>
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: '1.4fr 1.4fr 1fr' }}>
            <Tarjeta titulo="Conteo Mensual de Tareas por Canal"><Apiladas datos={apil('tareas')} series={series} modo="valor" ejeY="Recuento" /></Tarjeta>
            <Tarjeta titulo="% Mensual de Tareas por Canal"><Apiladas datos={apil('tareas')} series={series} modo="pct" ejeY="Recuento" /></Tarjeta>
            <div className="space-y-3">
              <Tarjeta titulo="% Total de Tareas por Canal"><Pastel partes={totalCanal('tareas')} /></Tarjeta>
              <Tarjeta titulo="Estado de tarea"><Pastel dona partes={[{ nombre: 'Completado', valor: d.estado.completadas, color: '#0b7a3b' }, { nombre: 'En proceso', valor: d.estado.en_proceso, color: '#f5a623' }, { nombre: 'Pendiente', valor: d.estado.otras, color: '#c4c4c4' }]} /></Tarjeta>
              <Tarjeta titulo="Prioridad de Tareas"><Pastel dona partes={[{ nombre: 'Alta', valor: d.prioridad.alta, color: '#2f6fed' }, { nombre: 'Media', valor: d.prioridad.media, color: '#8fb4ff' }, { nombre: 'Baja', valor: d.prioridad.baja, color: '#e6007e' }]} /></Tarjeta>
            </div>
          </div>
          <div className="text-center text-[10px] text-gray-400 pt-1">Generado por BackIO · Geeks Ecuador</div>
        </div>
      )}
    </div>
  );
}
