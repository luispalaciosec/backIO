'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';
import { iniciales } from '@/lib/format';

type Periodo = 'dia' | 'semana' | 'mes';
interface Persona {
  usuario_id: string; nombre: string; email: string; rol: string; avatar_url: string | null; capacidad_semanal: number; basecamp_user_id: number | null;
  activos: number; atrasados: number; en_ejecucion: number; bloqueados: number; esperando_cliente: number; sin_movimiento_7: number;
  entregados: number; piezas: number; pct_a_tiempo_original: number | null; pct_a_tiempo_vigente: number | null; desvio_mediana_dias: number | null;
  horas: number; horas_por_entrega: number | null; pct_capacidad: number | null; reprogramaciones_equipo: number; reprocesos: number; horas_reproceso: number;
  clientes: { cliente: string; activos: number; entregados: number }[]; serie_30d: { fecha: string; entregados: number; horas: number }[]; puntaje: number;
  dias_laborables: number; dias_con_horas: number; dias_sin_horas: string[]; horas_esperadas: number; dias: { fecha: string; horas: number; esperado: number; entregados: number }[];
}
interface Resumen { periodo: Periodo; desde: string; hasta: string; etiqueta: string; personas: Persona[] }

const COLOR_ROL: Record<string, string> = { admin: 'bg-gray-900 text-white', operaciones: 'bg-brand text-white', ejecutiva: 'bg-violet-600 text-white', lider: 'bg-amber-500 text-white', gerencia: 'bg-gray-700 text-white', colaborador: 'bg-gray-100 text-gray-700' };
const tono = (p: number) => (p >= 80 ? 'text-green-700' : p >= 60 ? 'text-amber-600' : 'text-red-700');
const anillo = (p: number) => (p >= 80 ? '#0B7A3B' : p >= 60 ? '#d97706' : '#c0392b');

function Avatar({ p, size = 56 }: { p: Persona; size?: number }) {
  return p.avatar_url
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={p.avatar_url} alt={p.nombre} width={size} height={size} className="rounded-full object-cover shrink-0 border border-gray-200" referrerPolicy="no-referrer" />
    : <div className="rounded-full bg-brand/10 text-brand font-bold flex items-center justify-center shrink-0" style={{ width: size, height: size, fontSize: size / 2.6 }}>{iniciales(p.nombre)}</div>;
}

function Sparkline({ serie }: { serie: Persona['serie_30d'] }) {
  const max = Math.max(1, ...serie.map((s) => s.entregados));
  return (
    <svg viewBox="0 0 120 28" className="w-full h-7" preserveAspectRatio="none" aria-label="Entregas últimos 30 días">
      {serie.map((s, i) => <rect key={s.fecha} x={i * 4} y={28 - (s.entregados / max) * 26} width={3} height={(s.entregados / max) * 26} fill={s.entregados ? '#0B7A3B' : '#e5e7eb'} rx={0.5}><title>{s.fecha}: {s.entregados} entregas · {s.horas} h</title></rect>)}
    </svg>
  );
}

function BarrasHoras({ dias }: { dias: Persona['dias'] }) {
  const max = Math.max(1, ...dias.map((d) => Math.max(d.horas, d.esperado)));
  const w = Math.max(3, Math.min(10, Math.floor(120 / Math.max(dias.length, 1)) - 1));
  return (
    <svg viewBox="0 0 120 30" className="w-full h-8" preserveAspectRatio="none" aria-label="Horas por día vs. esperado">
      {dias.map((d, i) => {
        const x = i * (w + 1); const hE = (d.esperado / max) * 26; const hH = (d.horas / max) * 26;
        const color = d.esperado === 0 ? '#e5e7eb' : d.horas === 0 ? '#c0392b' : d.horas < d.esperado * 0.6 ? '#d97706' : '#0073EA';
        return <g key={d.fecha}><rect x={x} y={30 - hE} width={w} height={hE} fill="#eef2f7" rx={0.5} /><rect x={x} y={30 - hH} width={w} height={hH} fill={color} rx={0.5} /><title>{d.fecha}: {d.horas} h de {d.esperado} esperadas · {d.entregados} entregas</title></g>;
      })}
    </svg>
  );
}

function Anillo({ valor }: { valor: number }) {
  const r = 22; const c = 2 * Math.PI * r; const v = Math.max(0, Math.min(100, valor));
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" className="shrink-0"><circle cx="28" cy="28" r={r} stroke="#e5e7eb" strokeWidth="6" fill="none" /><circle cx="28" cy="28" r={r} stroke={anillo(v)} strokeWidth="6" fill="none" strokeDasharray={`${(v / 100) * c} ${c}`} strokeLinecap="round" transform="rotate(-90 28 28)" /><text x="28" y="32" textAnchor="middle" fontSize="13" fontWeight="700" fill={anillo(v)}>{v}</text></svg>
  );
}

export default function PersonasPage() {
  const [periodo, setPeriodo] = useState<Periodo>('semana');
  const [d, setD] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orden, setOrden] = useState<'puntaje' | 'activos' | 'entregados' | 'horas' | 'atrasados' | 'dias_sin_horas_n'>('puntaje');
  const [abierta, setAbierta] = useState<Persona | null>(null);
  const cargar = useCallback(async () => { setError(null); try { setD(await api<Resumen>(`/personas?periodo=${periodo}`)); } catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); } }, [periodo]);
  useEffect(() => { void cargar(); }, [cargar]);
  const valor = (p: Persona) => (orden === 'dias_sin_horas_n' ? p.dias_sin_horas.length : (p[orden] as number));
  const personas = [...(d?.personas ?? [])].sort((a, b) => valor(b) - valor(a));
  const totales = d ? { entregados: d.personas.reduce((s, p) => s + p.entregados, 0), horas: Math.round(d.personas.reduce((s, p) => s + p.horas, 0)), esperadas: Math.round(d.personas.filter((p) => p.basecamp_user_id).reduce((s, p) => s + p.horas_esperadas, 0)), atrasados: d.personas.reduce((s, p) => s + p.atrasados, 0), reprocesos: d.personas.reduce((s, p) => s + p.reprocesos, 0), sin_timesheet: d.personas.filter((p) => p.basecamp_user_id && p.dias_laborables > 0 && p.dias_con_horas === 0).length } : null;
  const pct = (v: number | null) => (v === null ? '—' : `${v}%`);
  const fmt = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-EC', { day: 'numeric', month: 'short' });

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Personas</h1>
          <p className="text-sm text-gray-500">Rendimiento del equipo operativo por periodo (admin y gerencia no se miden aquí): entregas, cumplimiento sobre la fecha original, horas de Basecamp, reprocesos y carga. {d && <span className="text-gray-400">{d.etiqueta}: {fmt(d.desde)}{d.desde !== d.hasta ? ` – ${fmt(d.hasta)}` : ''}</span>}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5 text-sm">
            {(['dia', 'semana', 'mes'] as Periodo[]).map((p) => <button key={p} onClick={() => setPeriodo(p)} className={`px-3 py-1.5 rounded ${periodo === p ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-100'}`}>{p === 'dia' ? 'Hoy' : p === 'semana' ? 'Semana' : 'Mes'}</button>)}
          </div>
          <select className="input w-44" value={orden} onChange={(e) => setOrden(e.target.value as typeof orden)}>
            <option value="puntaje">Ordenar: puntaje</option><option value="activos">Ordenar: activos</option><option value="entregados">Ordenar: entregados</option><option value="horas">Ordenar: horas</option><option value="atrasados">Ordenar: atrasados</option><option value="dias_sin_horas_n">Ordenar: días sin timesheet</option>
          </select>
        </div>
      </header>
      {error && <Alert tipo="error">{error}</Alert>}
      {totales && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="card p-3"><div className="text-xs uppercase tracking-wide text-gray-500">Entregados</div><div className="text-2xl font-bold text-green-700">{totales.entregados}</div></div>
          <div className="card p-3"><div className="text-xs uppercase tracking-wide text-gray-500">Horas registradas</div><div className="text-2xl font-bold">{totales.horas}<span className="text-sm text-gray-400 font-normal"> / {totales.esperadas} esperadas</span></div>{totales.sin_timesheet > 0 && <div className="text-xs text-red-700 font-semibold">{totales.sin_timesheet} {totales.sin_timesheet === 1 ? 'persona' : 'personas'} sin ninguna hora</div>}</div>
          <div className="card p-3"><div className="text-xs uppercase tracking-wide text-gray-500">Atrasados hoy</div><div className={`text-2xl font-bold ${totales.atrasados ? 'text-red-700' : ''}`}>{totales.atrasados}</div></div>
          <div className="card p-3"><div className="text-xs uppercase tracking-wide text-gray-500">Reprocesos</div><div className={`text-2xl font-bold ${totales.reprocesos ? 'text-amber-600' : ''}`}>{totales.reprocesos}</div></div>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {personas.map((p) => (
          <button key={p.usuario_id} type="button" onClick={() => setAbierta(p)} className="card p-4 text-left hover:border-brand transition space-y-3">
            <div className="flex items-center gap-3">
              <Avatar p={p} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold truncate">{p.nombre}</div>
                <div className="flex items-center gap-2 text-xs"><span className={`rounded-full px-2 py-0.5 font-semibold ${COLOR_ROL[p.rol] ?? 'bg-gray-100'}`}>{p.rol}</span><span className="text-gray-500">{p.capacidad_semanal} h/sem</span>{!p.basecamp_user_id && <span className="text-amber-700" title="Sin vincular con Basecamp: no hay horas">sin Basecamp</span>}</div>
              </div>
              <Anillo valor={p.puntaje} />
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div><div className="text-lg font-bold text-green-700">{p.entregados}</div><div className="text-[10px] uppercase text-gray-500">Entregados</div></div>
              <div><div className={`text-lg font-bold ${tono(p.pct_a_tiempo_original ?? 100)}`}>{pct(p.pct_a_tiempo_original)}</div><div className="text-[10px] uppercase text-gray-500">A tiempo</div></div>
              <div><div className="text-lg font-bold">{p.horas}</div><div className="text-[10px] uppercase text-gray-500">Horas{p.pct_capacidad !== null ? ` · ${p.pct_capacidad}%` : ''}</div></div>
              <div><div className={`text-lg font-bold ${p.atrasados ? 'text-red-700' : 'text-gray-700'}`}>{p.atrasados}<span className="text-xs text-gray-400 font-normal">/{p.activos}</span></div><div className="text-[10px] uppercase text-gray-500">Atrasados</div></div>
            </div>
            <div>
              <div className="flex justify-between text-[10px] uppercase text-gray-500"><span>Timesheet {d?.etiqueta.toLowerCase()}</span><span className={p.dias_laborables && p.dias_con_horas === p.dias_laborables ? 'text-green-700' : p.dias_con_horas === 0 ? 'text-red-700 font-semibold' : 'text-amber-600'}>{p.dias_con_horas}/{p.dias_laborables} días · {p.horas}/{p.horas_esperadas} h</span></div>
              <BarrasHoras dias={p.dias} />
            </div>
            <div className="flex flex-wrap gap-1 text-[11px]">
              {p.dias_sin_horas.length > 0 && p.basecamp_user_id && <span className="rounded-full bg-red-50 text-red-700 px-2 py-0.5 font-semibold" title={p.dias_sin_horas.join(', ')}>⏱ {p.dias_sin_horas.length} {p.dias_sin_horas.length === 1 ? 'día' : 'días'} sin timesheet</span>}
              {!p.basecamp_user_id && <span className="rounded-full bg-gray-100 text-gray-600 px-2 py-0.5">⏱ sin timesheet (no vinculado a Basecamp)</span>}
              {p.reprocesos > 0 && <span className="rounded-full bg-red-50 text-red-700 px-2 py-0.5">⟲ {p.reprocesos} reproceso{p.reprocesos > 1 ? 's' : ''}</span>}
              {p.reprogramaciones_equipo > 0 && <span className="rounded-full bg-amber-50 text-amber-700 px-2 py-0.5">↺ {p.reprogramaciones_equipo} reprog. equipo</span>}
              {p.bloqueados > 0 && <span className="rounded-full bg-red-50 text-red-700 px-2 py-0.5">{p.bloqueados} bloqueada{p.bloqueados > 1 ? 's' : ''}</span>}
              {p.sin_movimiento_7 > 0 && <span className="rounded-full bg-gray-100 text-gray-600 px-2 py-0.5">{p.sin_movimiento_7} sin mover +7d</span>}
              {p.esperando_cliente > 0 && <span className="rounded-full bg-blue-50 text-blue-700 px-2 py-0.5">{p.esperando_cliente} espera cliente</span>}
            </div>
          </button>
        ))}
        {d && personas.length === 0 && <div className="card p-6 text-gray-500">Sin personas con actividad en este periodo.</div>}
        {!d && !error && <p className="text-sm text-gray-400">Calculando…</p>}
      </div>

      {abierta && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50" onClick={() => setAbierta(null)}>
          <div className="card w-full max-w-2xl max-h-[85vh] overflow-auto p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-4">
              <Avatar p={abierta} size={72} />
              <div className="flex-1 min-w-0"><div className="text-xl font-bold">{abierta.nombre}</div><div className="text-sm text-gray-500">{abierta.email} · {abierta.rol} · {abierta.capacidad_semanal} h/sem</div></div>
              <Anillo valor={abierta.puntaje} />
              <button className="btn-ghost" onClick={() => setAbierta(null)}>×</button>
            </div>
            <p className="text-xs text-gray-500">Puntaje orientativo: 40 % cumplimiento sobre fecha original, 30 % tareas sin atraso, 20 % bien a la primera, 10 % tareas con movimiento. {d?.etiqueta}.</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              {[
                ['Entregados', `${abierta.entregados} (${abierta.piezas} piezas)`], ['A tiempo (original)', pct(abierta.pct_a_tiempo_original)], ['A tiempo (vigente)', pct(abierta.pct_a_tiempo_vigente)], ['Desvío mediano', abierta.desvio_mediana_dias ? `${abierta.desvio_mediana_dias} d` : '—'],
                ['Horas', `${abierta.horas}${abierta.pct_capacidad !== null ? ` · ${abierta.pct_capacidad}% cap.` : ''}`], ['Horas por entrega', abierta.horas_por_entrega ?? '—'], ['Reprocesos', `${abierta.reprocesos} (${abierta.horas_reproceso} h)`], ['Reprog. del equipo', abierta.reprogramaciones_equipo],
                ['Activos', abierta.activos], ['En proceso', abierta.en_ejecucion], ['Atrasados', abierta.atrasados], ['Bloqueados', abierta.bloqueados],
              ].map(([k, v]) => <div key={String(k)} className="rounded-md bg-gray-50 p-3"><div className="text-[10px] uppercase tracking-wide text-gray-500">{k}</div><div className="font-semibold">{v as string}</div></div>)}
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Timesheet del periodo · {abierta.dias_con_horas}/{abierta.dias_laborables} días con horas · {abierta.horas} de {abierta.horas_esperadas} h esperadas</div>
              {!abierta.basecamp_user_id ? <p className="text-sm text-amber-700">No está vinculado a Basecamp: sin timesheet. Admin → Usuarios → Vincular con Basecamp.</p> : (
                <table className="w-full text-sm"><thead><tr><th className="th">Día</th><th className="th text-right">Horas</th><th className="th text-right">Esperadas</th><th className="th text-right">Entregas</th><th className="th"></th></tr></thead>
                  <tbody>{abierta.dias.map((x) => { const dow = new Date(`${x.fecha}T12:00:00Z`).toLocaleDateString('es-EC', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }); const falta = x.esperado > 0 && x.horas === 0; return (
                    <tr key={x.fecha} className={falta ? 'bg-red-50/60' : ''}><td className="td">{dow}</td><td className={`td text-right tabular-nums ${falta ? 'text-red-700 font-semibold' : ''}`}>{x.horas || (x.esperado ? '0' : '—')}</td><td className="td text-right tabular-nums text-gray-500">{x.esperado || '—'}</td><td className="td text-right tabular-nums text-green-700">{x.entregados || ''}</td><td className="td text-xs">{falta ? 'sin timesheet' : x.esperado && x.horas < x.esperado * 0.6 ? 'parcial' : ''}</td></tr>); })}</tbody></table>
              )}
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Últimos 30 días · entregas por día</div>
              <Sparkline serie={abierta.serie_30d} />
            </div>
            {abierta.clientes.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Clientes</div>
                <table className="w-full text-sm"><thead><tr><th className="th">Cliente</th><th className="th text-right">Activos</th><th className="th text-right">Entregados</th></tr></thead>
                  <tbody>{abierta.clientes.map((c) => <tr key={c.cliente}><td className="td">{c.cliente}</td><td className="td text-right tabular-nums">{c.activos}</td><td className="td text-right tabular-nums text-green-700">{c.entregados}</td></tr>)}</tbody></table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
