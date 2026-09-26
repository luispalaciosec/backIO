'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError, BACKEND } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { Alert } from '@/components/ui/Alert';
import { Tarjeta, BarrasDobles, Lineas } from '@/components/informe/Graficas';

interface MetricasDia { planificadas: number; cerradas_planificadas: number; cumplimiento_pct: number | null; cerradas_fuera: number; cerradas_total: number; nuevas_hoy: number; nuevas_no_planificadas: number; nuevas_urgentes: number; reprocesos_hoy: number; reprogramaciones_24h: number; bloqueos_nuevos: number; vencidas_abiertas: number }
interface PersonaDia { usuario_id: string; nombre: string; planificadas: number; cerradas: number; fuera: number }
interface Dia { fecha: string; metricas: MetricasDia; por_persona: PersonaDia[]; origen: string; publicado: boolean; apertura_publicada: boolean; en_vivo?: boolean }
interface MetricasSemana { comprometidas: number; pct_a_tiempo_original: number | null; pct_a_tiempo_vigente: number | null; arrastre: number; cerradas: number; plan_tareas: number | null; plan_cumplidas: number | null; pct_plan: number | null; reprocesos: number; reprogramaciones: number; reprogramaciones_equipo: number; reprogramaciones_cliente: number; senales_criticas: number; senales_altas: number; acuerdos: number; acuerdos_a_tiempo: number; dailies_apertura: number; dailies_cierre: number; dias_habiles: number }
interface Semana { fecha_inicio: string; fecha_fin: string; metricas: MetricasSemana; origen: string; en_vivo?: boolean }
interface Resumen { dias: number; dias_con_cierre: number; planificadas: number; cerradas_planificadas: number; cumplimiento_pct: number | null; cerradas_fuera: number; cerradas_total: number; fuera_de_plan: number; reprocesos: number; reprogramaciones: number; vencidas_promedio: number | null }
interface Evolutivo { mesa: { id: string; nombre: string }; mes: string; mesas: { id: string; nombre: string }[]; dias: Dia[]; semanas: Semana[]; resumen: Resumen; resumen_anterior: Resumen | null }

const KEY = 'backio:daily:mesa'; // misma mesa recordada que el Daily (preferencia de UI)
const mesActual = () => new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 7);
const moverMes = (m: string, n: number) => { const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const nombreMes = (m: string) => new Intl.DateTimeFormat('es-EC', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-15T12:00:00Z`));
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const diaSemana = (iso: string) => new Intl.DateTimeFormat('es-EC', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));

/** Flecha de tendencia vs el mes anterior. `mejorSiSube` define el color. */
function Delta({ ahora, antes, mejorSiSube, sufijo = '' }: { ahora: number | null; antes: number | null | undefined; mejorSiSube: boolean; sufijo?: string }) {
  if (ahora === null || antes === null || antes === undefined) return null;
  const d = Math.round((ahora - antes) * 10) / 10;
  if (d === 0) return <span className="text-xs text-gray-400">= mes anterior</span>;
  const bueno = d > 0 === mejorSiSube;
  return <span className={`text-xs font-semibold ${bueno ? 'text-emerald-700' : 'text-red-600'}`}>{d > 0 ? '↑' : '↓'} {Math.abs(d)}{sufijo} vs mes anterior</span>;
}

export default function EvolutivoPage() { return <Suspense><EvolutivoVista /></Suspense>; }

function EvolutivoVista() {
  const sp = useSearchParams(); const router = useRouter(); const me = useMe();
  const mes = sp.get('mes') && /^\d{4}-\d{2}$/.test(sp.get('mes')!) ? sp.get('mes')! : mesActual();
  const [mesa, setMesa] = useState<string>(sp.get('mesa') ?? '');
  const [d, setD] = useState<Evolutivo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [reconstruyendo, setReconstruyendo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  useEffect(() => { if (!mesa) { try { setMesa(localStorage.getItem(KEY) ?? ''); } catch { /* sin storage */ } } }, [mesa]);
  const cargar = () => { setError(null); api<Evolutivo>(`/evolutivo?mes=${mes}${mesa ? `&mesa=${mesa}` : ''}`).then((r) => { setD(r); if (!mesa) setMesa(r.mesa.id); }).catch((e) => setError(e instanceof ApiError ? e.message : 'Error')); };
  useEffect(() => { cargar(); }, [mes, mesa]); // eslint-disable-line react-hooks/exhaustive-deps
  const ir = (p: Record<string, string>) => { const q = new URLSearchParams(sp.toString()); for (const [k, v] of Object.entries(p)) q.set(k, v); router.replace(`/evolutivo?${q.toString()}`); };
  const elegirMesa = (id: string) => { setMesa(id); try { localStorage.setItem(KEY, id); } catch { /* sin storage */ } ir({ mesa: id }); };
  const r = d?.resumen, a = d?.resumen_anterior;
  const hayReconstruidos = d?.dias.some((x) => x.origen === 'reconstruido');

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Evolutivo de rituales</h1>
          <p className="text-sm text-gray-500">Cómo le fue a la mesa día a día (daily) y semana a semana (weekly). Cada día hábil queda una foto a las 19:30 o al publicar el cierre.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select className="input w-44" value={d?.mesa.id ?? mesa} onChange={(e) => elegirMesa(e.target.value)}>{(d?.mesas ?? []).map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select>
          <button className="btn-ghost" onClick={() => ir({ mes: moverMes(mes, -1) })}>‹</button>
          <div className="text-sm font-medium w-36 text-center capitalize">{nombreMes(mes)}</div>
          <button className="btn-ghost" onClick={() => ir({ mes: moverMes(mes, 1) })} disabled={mes >= mesActual()}>›</button>
          {d && <button className="btn-secondary text-xs" onClick={async () => {
            const { supabaseBrowser } = await import('@/lib/supabase/client');
            const { data } = await supabaseBrowser().auth.getSession();
            const res = await fetch(`${BACKEND}/api/v1/evolutivo/export?mesa=${d.mesa.id}&mes=${mes}`, { headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}` } });
            const url = URL.createObjectURL(await res.blob()); const el = document.createElement('a'); el.href = url; el.download = `evolutivo-${mes}.csv`; el.click(); URL.revokeObjectURL(url);
          }}>⬇ CSV</button>}
          {me?.rol === 'admin' && <button className="btn-ghost text-xs" disabled={reconstruyendo} title="Rehace días y semanas desde el 21/09 con la auditoría. No pisa fotos tomadas en vivo." onClick={async () => {
            setReconstruyendo(true); setAviso(null);
            try { const x = await api<{ dias: number; semanas: number }>('/evolutivo/reconstruir', { method: 'POST' }); setAviso(`Reconstruidos ${x.dias} días y ${x.semanas} semanas.`); cargar(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
            setReconstruyendo(false);
          }}>{reconstruyendo ? 'Reconstruyendo…' : '↻ Reconstruir desde 21/09'}</button>}
        </div>
      </header>
      {error && <Alert tipo="error">{error}</Alert>}
      {aviso && <Alert tipo="ok">{aviso}</Alert>}
      {!d && !error && <p className="text-sm text-gray-400">Cargando…</p>}
      {d && r && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="card p-3"><div className="text-xs uppercase tracking-wide text-gray-500">Cumplimiento del plan diario</div><div className="text-2xl font-bold">{r.cumplimiento_pct === null ? '—' : `${r.cumplimiento_pct}%`}</div><div className="text-xs text-gray-500">{r.cerradas_planificadas} de {r.planificadas} tareas elegidas</div><Delta ahora={r.cumplimiento_pct} antes={a?.cumplimiento_pct} mejorSiSube sufijo=" pts" /></div>
            <div className="card p-3"><div className="text-xs uppercase tracking-wide text-gray-500">Cerradas en el mes</div><div className="text-2xl font-bold">{r.cerradas_total}</div><div className="text-xs text-gray-500">{r.cerradas_fuera} fuera del daily</div><Delta ahora={r.cerradas_total} antes={a?.cerradas_total} mejorSiSube /></div>
            <div className="card p-3"><div className="text-xs uppercase tracking-wide text-gray-500">Entraron fuera de plan</div><div className="text-2xl font-bold">{r.fuera_de_plan}</div><div className="text-xs text-gray-500">{r.reprocesos} reprocesos · {r.reprogramaciones} reprogramaciones</div><Delta ahora={r.fuera_de_plan} antes={a?.fuera_de_plan} mejorSiSube={false} /></div>
            <div className="card p-3"><div className="text-xs uppercase tracking-wide text-gray-500">Vencidas abiertas (promedio)</div><div className="text-2xl font-bold">{r.vencidas_promedio ?? '—'}</div><div className="text-xs text-gray-500">cierre publicado {r.dias_con_cierre} de {r.dias} días</div><Delta ahora={r.vencidas_promedio} antes={a?.vencidas_promedio} mejorSiSube={false} /></div>
          </div>
          {hayReconstruidos && <p className="text-xs text-gray-500">Los días marcados «reconstruido» se rehicieron desde la auditoría: la selección del daily es exacta desde el 21/09; lo anterior no existe.</p>}

          {d.dias.length > 0 ? (
            <div className="grid gap-4 xl:grid-cols-2">
              <Tarjeta titulo="Plan del día: elegidas vs cerradas"><BarrasDobles datos={d.dias.map((x) => ({ etiqueta: dm(x.fecha), a: x.metricas.planificadas, b: x.metricas.cerradas_planificadas }))} a={{ id: 'a', nombre: 'Elegidas para el día', color: '#94a3b8' }} b={{ id: 'b', nombre: 'Cerradas del plan', color: '#059669' }} /></Tarjeta>
              <Tarjeta titulo="Lo que no estaba en el plan"><Lineas datos={d.dias.map((x) => ({ etiqueta: dm(x.fecha), a: x.metricas.cerradas_fuera, b: x.metricas.nuevas_no_planificadas + x.metricas.nuevas_urgentes }))} a={{ id: 'a', nombre: 'Cerradas fuera del daily', color: '#6366f1' }} b={{ id: 'b', nombre: 'Nuevas fuera de planificación', color: '#f59e0b' }} /></Tarjeta>
            </div>
          ) : <p className="text-sm text-gray-400">Aún no hay fotos del daily para este mes.</p>}

          {d.dias.length > 0 && (
            <section className="card overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead><tr className="text-xs text-gray-500">
                  <th className="th">Día</th><th className="th text-center">Plan</th><th className="th text-center">Cumplimiento</th><th className="th text-center">Fuera del daily</th><th className="th text-center">Nuevas</th><th className="th text-center">Reprocesos</th><th className="th text-center">Reprog.</th><th className="th text-center">Bloqueos</th><th className="th text-center">Vencidas</th><th className="th text-center">Cierre</th><th className="th"></th>
                </tr></thead>
                <tbody>
                  {d.dias.map((x) => (
                    <FilaDia key={x.fecha} x={x} abierto={abierto === x.fecha} onToggle={() => setAbierto(abierto === x.fecha ? null : x.fecha)} />
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <Tarjeta titulo="Semana a semana (weekly)">
            {d.semanas.length === 0 ? <p className="text-sm text-gray-400">Aún no hay semanas guardadas en este mes.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-gray-500"><th className="th">Indicador</th>{d.semanas.map((s) => <th key={s.fecha_inicio} className="th text-center">{dm(s.fecha_inicio)}–{dm(s.fecha_fin)}{s.en_vivo ? <div className="text-[10px] text-sky-700 font-normal">en curso</div> : s.origen === 'reconstruido' ? <div className="text-[10px] text-gray-400 font-normal">reconstruida</div> : null}</th>)}</tr></thead>
                  <tbody>
                    {([
                      ['Comprometidas en la semana', (m: MetricasSemana) => m.comprometidas],
                      ['A tiempo (fecha original)', (m: MetricasSemana) => (m.pct_a_tiempo_original === null ? '—' : `${m.pct_a_tiempo_original}%`)],
                      ['A tiempo (fecha vigente)', (m: MetricasSemana) => (m.pct_a_tiempo_vigente === null ? '—' : `${m.pct_a_tiempo_vigente}%`)],
                      ['Plan operativo cumplido', (m: MetricasSemana) => (m.pct_plan === null ? 'sin plan' : `${m.pct_plan}% (${m.plan_cumplidas}/${m.plan_tareas})`)],
                      ['Arrastre a la semana siguiente', (m: MetricasSemana) => m.arrastre],
                      ['Cerradas', (m: MetricasSemana) => m.cerradas],
                      ['Reprocesos', (m: MetricasSemana) => m.reprocesos],
                      ['Reprogramaciones (equipo / cliente)', (m: MetricasSemana) => `${m.reprogramaciones} (${m.reprogramaciones_equipo} / ${m.reprogramaciones_cliente})`],
                      ['Señales críticas y altas', (m: MetricasSemana) => m.senales_criticas + m.senales_altas],
                      ['Acuerdos cumplidos a tiempo', (m: MetricasSemana) => `${m.acuerdos_a_tiempo} de ${m.acuerdos}`],
                      ['Dailies publicados (apertura / cierre)', (m: MetricasSemana) => `${m.dailies_apertura} / ${m.dailies_cierre} de ${m.dias_habiles}`],
                    ] as [string, (m: MetricasSemana) => string | number][]).map(([k, f]) => (
                      <tr key={k} className="border-t border-gray-100"><td className="td text-gray-700">{k}</td>{d.semanas.map((s) => <td key={s.fecha_inicio} className="td text-center tabular-nums">{f(s.metricas)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[11px] text-gray-400 mt-2">Los acuerdos del weekly son de toda la agencia (no tienen mesa). La semana en curso se calcula en vivo y se congela el domingo a las 17:55.</p>
              </div>
            )}
          </Tarjeta>
        </>
      )}
    </div>
  );
}

function FilaDia({ x, abierto, onToggle }: { x: Dia; abierto: boolean; onToggle: () => void }) {
  const m = x.metricas;
  const tono = m.cumplimiento_pct === null ? 'text-gray-400' : m.cumplimiento_pct >= 80 ? 'text-emerald-700' : m.cumplimiento_pct >= 50 ? 'text-amber-600' : 'text-red-600';
  return (
    <>
      <tr className={`border-t border-gray-100 ${x.en_vivo ? 'bg-sky-50/50' : ''}`}>
        <td className="td whitespace-nowrap"><span className="capitalize text-gray-500">{diaSemana(x.fecha)}</span> {dm(x.fecha)}{x.en_vivo && <span className="ml-1 text-[10px] text-sky-700">en vivo</span>}{x.origen === 'reconstruido' && <span className="ml-1 text-[10px] text-gray-400">reconstruido</span>}</td>
        <td className="td text-center tabular-nums">{m.cerradas_planificadas}/{m.planificadas}</td>
        <td className={`td text-center tabular-nums font-semibold ${tono}`}>{m.cumplimiento_pct === null ? '—' : `${m.cumplimiento_pct}%`}</td>
        <td className="td text-center tabular-nums">{m.cerradas_fuera}</td>
        <td className="td text-center tabular-nums">{m.nuevas_hoy}{m.nuevas_no_planificadas + m.nuevas_urgentes ? <span className="text-amber-600"> ({m.nuevas_no_planificadas + m.nuevas_urgentes} fuera)</span> : ''}</td>
        <td className="td text-center tabular-nums">{m.reprocesos_hoy || ''}</td>
        <td className="td text-center tabular-nums">{m.reprogramaciones_24h || ''}</td>
        <td className="td text-center tabular-nums">{m.bloqueos_nuevos || ''}</td>
        <td className="td text-center tabular-nums">{m.vencidas_abiertas}</td>
        <td className="td text-center">{x.publicado ? '🔴 ✓' : x.apertura_publicada ? <span className="text-xs text-gray-400">solo apertura</span> : <span className="text-xs text-gray-300">—</span>}</td>
        <td className="td text-right">{x.por_persona.length > 0 && <button className="text-xs link-action" onClick={onToggle}>{abierto ? 'ocultar' : 'por persona'}</button>}</td>
      </tr>
      {abierto && (
        <tr><td colSpan={11} className="bg-gray-50 px-4 py-2">
          <div className="flex flex-wrap gap-2">{x.por_persona.map((p) => <span key={p.usuario_id} className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs"><b>{p.nombre}</b>: {p.cerradas}/{p.planificadas} del plan{p.fuera ? ` · +${p.fuera} fuera` : ''}</span>)}</div>
        </td></tr>
      )}
    </>
  );
}
