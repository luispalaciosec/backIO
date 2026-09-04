'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Mesa } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';
import { Barras, Kpi, Semaforo } from '@/components/dashboard/Charts';
import { fechaCorta, ESTADO_LABEL } from '@/lib/format';
import { COLOR_ESTADO } from '@/components/backlog/colores';

interface Dashboard {
  generado_at: string;
  mesa: { id: string; nombre: string } | null;
  kpis: Record<string, number>;
  por_cliente: { cliente_id: string; cliente: string; mesa: string | null; activos: number; atrasados: number; esperando_cliente: number; sin_movimiento_max: number; completados_30d: number; piezas_activas: number; proyectos: number; avance_promedio: number; salud: 'verde' | 'amarillo' | 'rojo' }[];
  por_persona: { usuario_id: string; nombre: string; activos: number; semana_actual: number; atrasados: number; capacidad_semanal: number; pct_semana: number }[];
  por_estado: { estado: string; n: number }[];
  ultimas_8_semanas: { semana_inicio: string; completados: number; piezas: number; vencian: number; a_tiempo: number }[];
  arrastre: { requerimiento_id: string; titulo: string; cliente: string; owner: string | null; veces_reprogramado: number; fecha_original: string | null; fecha_actual: string | null; dias_arrastre: number; estado: string }[];
}

export default function DashboardPage() {
  const [d, setD] = useState<Dashboard | null>(null);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [mesa, setMesa] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api<{ items: Mesa[] }>('/mesas').then((r) => setMesas(r.items.filter((m) => m.activa))).catch(() => {}); }, []);
  useEffect(() => {
    setD(null);
    api<Dashboard>(`/dashboard${mesa ? `?mesa=${mesa}` : ''}`).then(setD).catch((e) => setError(e instanceof ApiError ? e.message : 'Error'));
  }, [mesa]);

  if (error) return <Alert tipo="error">{error}</Alert>;
  const k = d?.kpis;
  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-gray-500">{d ? `Actualizado ${new Date(d.generado_at).toLocaleTimeString('es-EC')}` : 'Cargando…'} · calculado sobre el backlog, no declarado</p>
        </div>
        <select className="input w-52" value={mesa} onChange={(e) => setMesa(e.target.value)}>
          <option value="">Toda la agencia</option>
          {mesas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
        </select>
      </header>

      {k && (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-6">
          <Kpi etiqueta="Activos" valor={k.activos!} sub={`${k.proyectos_activos} proyectos · ${k.avance_promedio}% avance prom.`} />
          <Kpi etiqueta="Atrasados" valor={k.atrasados!} tono={k.atrasados! > 0 ? 'bad' : 'ok'} />
          <Kpi etiqueta="Sin movimiento >14d" valor={k.sin_movimiento_14!} tono={k.sin_movimiento_14! > 0 ? 'warn' : 'ok'} sub="la métrica que importa" />
          <Kpi etiqueta="Esperando cliente" valor={k.esperando_cliente!} tono={k.esperando_cliente! > 0 ? 'warn' : 'neutral'} />
          <Kpi etiqueta="Reprogramados ≥2" valor={k.reprogramados_2mas!} tono={k.reprogramados_2mas! > 0 ? 'bad' : 'ok'} sub={`${k.bloqueados} bloqueados`} />
          <Kpi etiqueta="Completados 30d" valor={k.completados_30d!} tono="ok" sub={`${k.piezas_completadas_30d} piezas · ${k.piezas_activas} en curso`} />
        </div>
      )}

      {d && (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="card p-4">
            <div className="font-semibold mb-1">Entregas por semana</div>
            <div className="text-xs text-gray-500 mb-3">Barra azul: completados. Fondo gris: los que vencían esa semana.</div>
            <Barras datos={d.ultimas_8_semanas.map((s) => ({ etiqueta: fechaCorta(s.semana_inicio), valor: s.completados, secundario: s.vencian }))} />
            <div className="grid grid-cols-8 text-center text-[10px] text-gray-500 mt-1">
              {d.ultimas_8_semanas.map((s) => <div key={s.semana_inicio}>{s.vencian ? `${Math.round((s.a_tiempo / s.vencian) * 100)}% a tiempo` : '—'}</div>)}
            </div>
          </section>
          <section className="card p-4">
            <div className="font-semibold mb-1">Piezas entregadas por semana</div>
            <div className="text-xs text-gray-500 mb-3">Suma de piezas de requerimientos completados.</div>
            <Barras datos={d.ultimas_8_semanas.map((s) => ({ etiqueta: fechaCorta(s.semana_inicio), valor: s.piezas }))} color="#A25DDC" />
          </section>

          <section className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 font-semibold">Salud por cliente</div>
            <table className="w-full text-sm">
              <thead><tr><th className="th"></th><th className="th">Cliente</th><th className="th text-right">Activos</th><th className="th text-right">Atraso</th><th className="th text-right">Espera cliente</th><th className="th text-right">Sin mov. máx</th><th className="th text-right">Hechos 30d</th><th className="th text-right">Piezas</th></tr></thead>
              <tbody>
                {d.por_cliente.map((c) => (
                  <tr key={c.cliente_id} className="hover:bg-gray-50">
                    <td className="td"><Semaforo salud={c.salud} /></td>
                    <td className="td"><Link className="hover:underline" href={`/backlog`}>{c.cliente}</Link>{c.mesa && <div className="text-[10px] text-gray-400">{c.mesa}</div>}</td>
                    <td className="td text-right tabular-nums">{c.activos}</td>
                    <td className={`td text-right tabular-nums ${c.atrasados ? 'text-red-600 font-semibold' : ''}`}>{c.atrasados || ''}</td>
                    <td className={`td text-right tabular-nums ${c.esperando_cliente ? 'text-amber-600' : ''}`}>{c.esperando_cliente || ''}</td>
                    <td className={`td text-right tabular-nums ${c.sin_movimiento_max > 14 ? 'text-amber-600 font-semibold' : ''}`}>{c.sin_movimiento_max}</td>
                    <td className="td text-right tabular-nums text-green-700">{c.completados_30d}</td>
                    <td className="td text-right tabular-nums">{c.piezas_activas}</td>
                  </tr>
                ))}
                {d.por_cliente.length === 0 && <tr><td className="td text-gray-400" colSpan={8}>Sin actividad.</td></tr>}
              </tbody>
            </table>
          </section>

          <section className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 font-semibold">Carga por persona</div>
            <table className="w-full text-sm">
              <thead><tr><th className="th">Persona</th><th className="th text-right">Activos</th><th className="th text-right">Esta semana</th><th className="th text-right">% semana</th><th className="th text-right">Atrasados</th></tr></thead>
              <tbody>
                {d.por_persona.map((p) => (
                  <tr key={p.usuario_id}>
                    <td className="td">{p.nombre}</td>
                    <td className="td text-right tabular-nums">{p.activos}</td>
                    <td className="td text-right tabular-nums">{p.semana_actual}</td>
                    <td className={`td text-right tabular-nums ${p.pct_semana > 30 ? 'text-red-600 font-semibold' : ''}`}>{p.semana_actual ? `${p.pct_semana}%` : ''}</td>
                    <td className={`td text-right tabular-nums ${p.atrasados ? 'text-red-600' : ''}`}>{p.atrasados || ''}</td>
                  </tr>
                ))}
                {d.por_persona.length === 0 && <tr><td className="td text-gray-400" colSpan={5}>Sin asignaciones.</td></tr>}
              </tbody>
            </table>
            <div className="px-4 py-3 border-t border-gray-100 flex flex-wrap gap-2">
              {d.por_estado.map((e) => (
                <span key={e.estado} className="inline-flex items-center gap-1 text-xs"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLOR_ESTADO[e.estado] }} />{ESTADO_LABEL[e.estado]} <b>{e.n}</b></span>
              ))}
            </div>
          </section>

          <section className="card overflow-hidden lg:col-span-2">
            <div className="px-4 py-3 border-b border-gray-200 font-semibold flex justify-between"><span>Arrastre</span><span className="text-sm font-normal text-gray-500">reprogramados o vencidos, ordenados por reincidencia</span></div>
            <table className="w-full text-sm">
              <thead><tr><th className="th">Requerimiento</th><th className="th">Cliente</th><th className="th">Owner</th><th className="th text-right">Reprog.</th><th className="th">Fecha original</th><th className="th">Fecha actual</th><th className="th text-right">Días arrastre</th><th className="th">Estado</th></tr></thead>
              <tbody>
                {d.arrastre.map((a) => (
                  <tr key={a.requerimiento_id} className={a.veces_reprogramado >= 2 ? 'bg-red-50/50' : ''}>
                    <td className="td">{a.titulo}</td><td className="td">{a.cliente}</td><td className="td">{a.owner ?? '—'}</td>
                    <td className={`td text-right tabular-nums ${a.veces_reprogramado >= 2 ? 'text-red-600 font-semibold' : ''}`}>{a.veces_reprogramado}</td>
                    <td className="td">{fechaCorta(a.fecha_original)}</td><td className="td">{fechaCorta(a.fecha_actual)}</td>
                    <td className="td text-right tabular-nums">{a.dias_arrastre}</td>
                    <td className="td"><span className="rounded px-2 py-0.5 text-xs text-white" style={{ backgroundColor: COLOR_ESTADO[a.estado] }}>{ESTADO_LABEL[a.estado]}</span></td>
                  </tr>
                ))}
                {d.arrastre.length === 0 && <tr><td className="td text-gray-400" colSpan={8}>Sin arrastre. Así debería verse siempre.</td></tr>}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </div>
  );
}
