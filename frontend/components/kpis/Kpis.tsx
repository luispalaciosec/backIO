'use client';
/**
 * KPIs por equipo y por persona (docs/19-kpis.md). Componentes compartidos por /kpis y el modal de Personas.
 */
import { useCallback, useEffect, useState } from 'react';
import type { KpiTablero, KpiValor, KpiDefinicion, KpiDetalleTarea, Usuario, Atribuible } from '@backio/shared';
import { AREA_LABEL, ATRIBUIBLE_LABEL, CALCULO_KPI_LABEL } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { fecha, diaLocal, iniciales } from '@/lib/format';
import { ComoSeCalcula } from './ComoSeCalcula';

type Kpi = KpiTablero['areas'][number]['kpis'][number];

export const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v * 1000) / 10}%`);
const COLOR: Record<KpiValor['estado'], string> = { cumple: 'bg-emerald-600 text-white', no_cumple: 'bg-red-600 text-white', sin_dato: 'bg-gray-100 text-gray-400' };
const COLOR_SUAVE: Record<KpiValor['estado'], string> = { cumple: 'bg-emerald-50 text-emerald-800 border-emerald-200', no_cumple: 'bg-red-50 text-red-800 border-red-200', sin_dato: 'bg-gray-50 text-gray-400 border-gray-200' };
const ETIQUETA: Record<KpiValor['estado'], string> = { cumple: 'Cumple', no_cumple: 'No cumple', sin_dato: 'Sin dato' };

export function mesActual(): string {
  const d = new Date(Date.now() - 5 * 3600_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
export function moverMes(mes: string, n: number): string {
  const d = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
export const nombreMes = (mes: string) => new Intl.DateTimeFormat('es-EC', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${mes}-15T12:00:00Z`));

export function EstadoKpi({ v, grande = false }: { v: KpiValor; grande?: boolean }) {
  return <span className={`inline-flex items-center rounded-full px-2 ${grande ? 'py-0.5 text-xs' : 'text-[10px]'} font-semibold ${COLOR[v.estado]}`}>{ETIQUETA[v.estado]}</span>;
}

function Origen({ v }: { v: KpiValor }) {
  if (v.origen === 'ajustado') return <span className="text-[10px] rounded bg-amber-100 text-amber-800 px-1.5" title={v.medicion?.justificacion_ajuste ?? ''}>ajustado</span>;
  if (v.origen === 'manual') return <span className="text-[10px] rounded bg-violet-100 text-violet-800 px-1.5">manual</span>;
  if (v.origen === 'auto') return <span className="text-[10px] rounded bg-sky-100 text-sky-800 px-1.5" title={v.estimado ? 'Estimado con datos anteriores a las rondas de revisión' : 'Calculado por BackIO'}>{v.estimado ? 'estimado' : 'automático'}</span>;
  return null;
}

function Tendencia({ serie }: { serie: Kpi['serie'] }) {
  const puntos = serie.map((s) => s.resultado);
  const max = Math.max(1, ...puntos.map((p) => p ?? 0));
  const w = 84, h = 22, paso = serie.length > 1 ? w / (serie.length - 1) : w;
  const xy = serie.map((s, i) => (s.resultado === null ? null : [i * paso, h - 2 - (s.resultado / max) * (h - 4)] as const));
  const linea = xy.filter(Boolean).map((p) => `${p![0].toFixed(1)},${p![1].toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible" aria-label="Tendencia">
      {linea && <polyline points={linea} fill="none" stroke="#94a3b8" strokeWidth={1.5} />}
      {xy.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={i === serie.length - 1 ? 3 : 2} fill={serie[i]!.estado === 'cumple' ? '#059669' : serie[i]!.estado === 'no_cumple' ? '#dc2626' : '#cbd5e1'}><title>{`${serie[i]!.periodo}: ${pct(serie[i]!.resultado)}`}</title></circle>)}
    </svg>
  );
}

function Avatar({ nombre, url, size = 28 }: { nombre: string; url: string | null; size?: number }) {
  return url
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={url} alt={nombre} title={nombre} width={size} height={size} className="rounded-full object-cover border border-gray-200" referrerPolicy="no-referrer" />
    : <span title={nombre} className="rounded-full bg-brand/10 text-brand font-bold inline-flex items-center justify-center" style={{ width: size, height: size, fontSize: size / 2.6 }}>{iniciales(nombre)}</span>;
}

export interface Seleccion { kpi: Kpi; usuarioId: string | null; nombre: string; valor: KpiValor }

/** Vista por equipo: por área, cada KPI con valor del equipo y la matriz de integrantes. */
export function VistaEquipo({ tablero, onAbrir, onPersona }: { tablero: KpiTablero; onAbrir: (s: Seleccion) => void; onPersona: (id: string) => void }) {
  return (
    <div className="space-y-6">
      {tablero.areas.filter((a) => a.kpis.length).map((a) => (
        <section key={a.area} className="card overflow-hidden">
          <header className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between gap-3 flex-wrap">
            <div className="font-semibold">{AREA_LABEL[a.area]} <span className="text-gray-400 font-normal text-sm">· {a.integrantes} {a.integrantes === 1 ? 'persona' : 'personas'}</span></div>
            <div className="flex items-center gap-1">{a.kpis[0]?.personas.map((p) => <button key={p.usuario_id} type="button" onClick={() => onPersona(p.usuario_id)} className="hover:ring-2 hover:ring-brand rounded-full"><Avatar nombre={p.nombre} url={p.avatar_url} size={26} /></button>)}</div>
          </header>
          {a.integrantes === 0 && <p className="px-4 py-3 text-sm text-amber-700">Nadie tiene asignada esta área. Asígnala en Admin → Usuarios para que se calculen sus KPIs.</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-gray-500">
                <th className="th w-[34%]">Indicador</th><th className="th text-center">Meta</th><th className="th text-center">Equipo</th><th className="th text-center">Tendencia</th>
                {a.kpis[0]?.personas.map((p) => <th key={p.usuario_id} className="th text-center font-normal whitespace-nowrap" title={p.nombre}>{p.nombre.split(' ')[0]}</th>)}
              </tr></thead>
              <tbody>
                {a.kpis.map((k) => (
                  <tr key={k.definicion.id} className="border-t border-gray-100">
                    <td className="td">
                      <div className="font-medium">{k.definicion.indicador}</div>
                      <div className="text-xs text-gray-400 flex gap-2 items-center"><span>{k.definicion.codigo}</span><span>· {k.definicion.periodicidad}</span><Origen v={k.equipo} /></div>
                    </td>
                    <td className="td text-center tabular-nums text-gray-600 whitespace-nowrap">{k.definicion.operador === '>=' ? '≥' : '≤'} {pct(k.definicion.meta)}</td>
                    <td className="td text-center">
                      <button type="button" onClick={() => onAbrir({ kpi: k, usuarioId: null, nombre: `Equipo ${AREA_LABEL[a.area]}`, valor: k.equipo })} className={`rounded-md border px-2 py-1 tabular-nums font-semibold hover:ring-2 hover:ring-brand/40 ${COLOR_SUAVE[k.equipo.estado]}`} title={`${k.equipo.dato_a ?? '—'} / ${k.equipo.dato_b ?? '—'}`}>
                        {pct(k.equipo.resultado)}
                      </button>
                    </td>
                    <td className="td text-center"><Tendencia serie={k.serie} /></td>
                    {k.personas.map((p) => (
                      <td key={p.usuario_id} className="td text-center">
                        <button type="button" onClick={() => onAbrir({ kpi: k, usuarioId: p.usuario_id, nombre: p.nombre, valor: p.valor })} className={`rounded px-1.5 py-0.5 text-xs tabular-nums border hover:ring-2 hover:ring-brand/40 ${COLOR_SUAVE[p.valor.estado]}`} title={`${p.nombre}: ${p.valor.dato_a ?? '—'} / ${p.valor.dato_b ?? '—'}${p.valor.origen === 'ajustado' ? ' · ajustado' : ''}`}>
                          {p.valor.estado === 'sin_dato' ? '—' : pct(p.valor.resultado)}
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

/** Ficha de una persona: todos los KPIs de su área, su valor vs meta y el del equipo. */
export function FichaPersona({ tablero, usuarioId, onAbrir }: { tablero: KpiTablero; usuarioId: string; onAbrir: (s: Seleccion) => void }) {
  const area = tablero.areas.find((a) => a.kpis.some((k) => k.personas.some((p) => p.usuario_id === usuarioId)));
  if (!area) return <p className="text-sm text-gray-500">Todavía no hay un área asignada, así que no hay KPIs que mostrar. La asigna un administrador en Admin → Usuarios.</p>;
  const filas = area.kpis.map((k) => ({ k, p: k.personas.find((x) => x.usuario_id === usuarioId)! }));
  const cumple = filas.filter((f) => f.p.valor.estado === 'cumple').length;
  const conDato = filas.filter((f) => f.p.valor.estado !== 'sin_dato').length;
  return (
    <div className="space-y-3">
      <div className="text-sm text-gray-600">{AREA_LABEL[area.area]} · cumple <b>{cumple}</b> de <b>{conDato}</b> KPIs con dato</div>
      <div className="grid gap-3 md:grid-cols-2">
        {filas.map(({ k, p }) => (
          <button key={k.definicion.id} type="button" onClick={() => onAbrir({ kpi: k, usuarioId, nombre: p.nombre, valor: p.valor })} className={`text-left rounded-lg border p-3 hover:ring-2 hover:ring-brand/40 ${COLOR_SUAVE[p.valor.estado]}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-medium text-gray-900">{k.definicion.indicador}</div>
              <EstadoKpi v={p.valor} />
            </div>
            <div className="mt-2 flex items-end justify-between gap-2">
              <div>
                <div className="text-2xl font-bold tabular-nums text-gray-900">{pct(p.valor.resultado)}</div>
                <div className="text-xs text-gray-500">{p.valor.dato_a ?? '—'} de {p.valor.dato_b ?? '—'} · meta {k.definicion.operador === '>=' ? '≥' : '≤'} {pct(p.valor.meta)}</div>
              </div>
              <div className="text-right text-xs text-gray-500">Equipo<div className="font-semibold tabular-nums text-gray-700">{pct(k.equipo.resultado)}</div></div>
            </div>
            <div className="mt-1 flex gap-2 items-center text-[10px] text-gray-400">{k.definicion.codigo}<Origen v={p.valor} /></div>
          </button>
        ))}
      </div>
      <section className="pt-4 space-y-3">
        <div>
          <h3 className="text-lg font-bold">¿Cómo se calcula cada KPI?</h3>
          <p className="text-sm text-gray-500">Con tus números de este periodo: cada cuadrito es una tarea, y abajo ves cuánto te falta para la meta.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {filas.map(({ k, p }) => <ComoSeCalcula key={k.definicion.id} def={k.definicion} v={p.valor} equipo={k.equipo} />)}
        </div>
      </section>
    </div>
  );
}

/** Detalle de un KPI (equipo o persona): definición, tareas que lo componen y formulario de seguimiento. */
export function DetalleKpi({ sel, mes, puedeRegistrar, usuarios, onClose, onGuardado }: { sel: Seleccion; mes: string; puedeRegistrar: boolean; usuarios: Usuario[]; onClose: () => void; onGuardado: () => void }) {
  const def: KpiDefinicion = sel.kpi.definicion;
  const m = sel.valor.medicion;
  const manual = def.calculo === 'manual';
  const [tareas, setTareas] = useState<KpiDetalleTarea[] | null>(manual ? [] : null);
  const [f, setF] = useState({
    dato_a: m?.dato_a ?? sel.valor.dato_a ?? '', dato_b: m?.dato_b ?? sel.valor.dato_b ?? '', ajustar: m?.origen === 'ajustado', justificacion_ajuste: m?.justificacion_ajuste ?? '',
    tasa_respuesta: m?.tasa_respuesta !== null && m?.tasa_respuesta !== undefined ? String(Math.round(m.tasa_respuesta * 100)) : '',
    causa: m?.causa ?? '', atribuible: (m?.atribuible ?? '') as Atribuible | '', evidencia_url: m?.evidencia_url ?? '', plan_mejora: m?.plan_mejora ?? '',
    responsable_id: m?.responsable_id ?? '', fecha_seguimiento: m?.fecha_seguimiento ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (manual) return;
    api<{ tareas: KpiDetalleTarea[] }>(`/kpis/${def.codigo}?periodo=${mes}${sel.usuarioId ? `&usuario=${sel.usuarioId}` : ''}`).then((r) => setTareas(r.tareas)).catch(() => setTareas([]));
  }, [def.codigo, mes, sel.usuarioId, manual]);

  async function guardar() {
    setBusy(true); setErr(null);
    const num = (v: string | number) => (v === '' ? null : Number(v));
    const cambiaDatos = manual || f.ajustar;
    try {
      await api(`/kpis/${def.codigo}/mediciones`, { method: 'PUT', json: {
        mes, usuario_id: sel.usuarioId,
        ...(cambiaDatos ? { dato_a: num(f.dato_a), dato_b: num(f.dato_b) } : {}),
        justificacion_ajuste: f.ajustar ? f.justificacion_ajuste.trim() || null : null,
        tasa_respuesta: f.tasa_respuesta === '' ? null : Number(f.tasa_respuesta) / 100,
        causa: f.causa.trim() || null, atribuible: f.atribuible || null, evidencia_url: f.evidencia_url.trim() || null, plan_mejora: f.plan_mejora.trim() || null,
        responsable_id: f.responsable_id || null, fecha_seguimiento: f.fecha_seguimiento || null,
      } });
      onGuardado(); onClose();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'No se pudo guardar'); }
    setBusy(false);
  }
  async function quitarAjuste() {
    if (!m || !confirm('¿Quitar el ajuste y volver al valor calculado por BackIO?')) return;
    setBusy(true);
    try { await api(`/kpis/${def.codigo}/mediciones/${m.id}`, { method: 'DELETE' }); onGuardado(); onClose(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Error'); }
    setBusy(false);
  }
  const enA = tareas?.filter((t) => t.cuenta_en_a) ?? [], fuera = tareas?.filter((t) => !t.cuenta_en_a) ?? [];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50" onClick={onClose}>
      <div className="card w-full max-w-3xl max-h-[88vh] overflow-auto p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs text-gray-400">{def.codigo} · {AREA_LABEL[def.area]} · {CALCULO_KPI_LABEL[def.calculo]}</div>
            <div className="font-semibold text-lg">{def.indicador}</div>
            <div className="text-sm text-gray-600">{sel.nombre} · {nombreMes(mes)}{def.periodicidad === 'trimestral' ? ' (trimestre)' : ''}</div>
          </div>
          <button className="btn-ghost" onClick={onClose}>×</button>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="text-3xl font-bold tabular-nums">{pct(sel.valor.resultado)}</div>
          <EstadoKpi v={sel.valor} grande /><Origen v={sel.valor} />
          <div className="text-sm text-gray-600">{sel.valor.dato_a ?? '—'} de {sel.valor.dato_b ?? '—'} · meta {def.operador === '>=' ? '≥' : '≤'} {pct(sel.valor.meta)}</div>
        </div>
        <div className="grid gap-2 md:grid-cols-2 text-sm">
          <div className="rounded-md bg-gray-50 p-2"><div className="text-xs text-gray-500">Dato A</div>{def.numerador_label}</div>
          <div className="rounded-md bg-gray-50 p-2"><div className="text-xs text-gray-500">Dato B</div>{def.denominador_label}</div>
        </div>
        {def.regla && <p className="text-xs text-gray-500">Regla: {def.regla}</p>}

        {!manual && (
          <section>
            <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Tareas que componen el cálculo</div>
            {tareas === null && <p className="text-sm text-gray-400">Cargando…</p>}
            {tareas && tareas.length === 0 && <p className="text-sm text-gray-400">No hay tareas en este periodo.</p>}
            {tareas && tareas.length > 0 && (
              <div className="max-h-64 overflow-auto rounded-md border border-gray-200">
                <table className="w-full text-xs">
                  <tbody>
                    {[...fuera, ...enA].map((t) => (
                      <tr key={t.id} className="border-b border-gray-100">
                        <td className="px-2 py-1 w-6">{t.cuenta_en_a ? <span className="text-emerald-600">✓</span> : <span className="text-red-600">✗</span>}</td>
                        <td className="px-2 py-1">{t.titulo}{t.basecamp_url && <a className="ml-1 font-bold text-emerald-700" href={t.basecamp_url} target="_blank" rel="noreferrer">Bc↗</a>}{t.nota && <span className="ml-1 text-amber-700">· {t.nota}</span>}</td>
                        <td className="px-2 py-1 text-gray-500">{t.cliente}</td>
                        <td className="px-2 py-1 text-gray-500">{t.responsables}</td>
                        <td className="px-2 py-1 text-gray-500 whitespace-nowrap">{fecha(diaLocal(t.fecha))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[11px] text-gray-400 mt-1">✓ cuenta en el dato A · ✗ solo en el dato B. {def.operador === '<=' ? 'En este KPI, menos es mejor.' : ''}</p>
          </section>
        )}

        <section className="space-y-3 border-t border-gray-100 pt-3">
          <div className="text-xs uppercase tracking-wide text-gray-500">Seguimiento</div>
          {!puedeRegistrar && (
            <div className="text-sm text-gray-600 space-y-1">
              {m?.causa ? <p><b>Causa:</b> {m.causa}</p> : null}
              {m?.plan_mejora ? <p><b>Plan de mejora:</b> {m.plan_mejora}</p> : null}
              {!m?.causa && !m?.plan_mejora && <p className="text-gray-400">Sin seguimiento registrado. Lo registran admin, gerencia u operaciones.</p>}
            </div>
          )}
          {puedeRegistrar && (
            <div className="grid gap-3 md:grid-cols-2">
              {!manual && <label className="md:col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.ajustar} onChange={(e) => setF({ ...f, ajustar: e.target.checked })} /> Corregir el valor calculado (requiere justificación)</label>}
              {(manual || f.ajustar) && <>
                <div><label className="label">Dato A</label><input className="input" type="number" min={0} step="any" value={f.dato_a} onChange={(e) => setF({ ...f, dato_a: e.target.value })} /></div>
                <div><label className="label">Dato B</label><input className="input" type="number" min={0} step="any" value={f.dato_b} onChange={(e) => setF({ ...f, dato_b: e.target.value })} /></div>
              </>}
              {f.ajustar && <div className="md:col-span-2"><label className="label">Justificación del ajuste *</label><input className="input" value={f.justificacion_ajuste} onChange={(e) => setF({ ...f, justificacion_ajuste: e.target.value })} placeholder="Por qué el cálculo automático no refleja la realidad" /></div>}
              {def.codigo === 'KPI-CUE-02' && <div><label className="label">Tasa de respuesta de la encuesta (%)</label><input className="input" type="number" min={0} max={100} value={f.tasa_respuesta} onChange={(e) => setF({ ...f, tasa_respuesta: e.target.value })} /><p className="text-[11px] text-gray-400 mt-0.5">{f.tasa_respuesta === '' ? '' : Number(f.tasa_respuesta) >= 70 ? 'Muestra válida' : 'Muestra insuficiente (<70%)'}</p></div>}
              <div className="md:col-span-2"><label className="label">Causa / observación</label><textarea className="input" rows={2} value={f.causa} onChange={(e) => setF({ ...f, causa: e.target.value })} /></div>
              <div><label className="label">Atribuible</label><select className="input" value={f.atribuible} onChange={(e) => setF({ ...f, atribuible: e.target.value as Atribuible | '' })}><option value="">—</option>{(Object.keys(ATRIBUIBLE_LABEL) as Atribuible[]).map((a) => <option key={a} value={a}>{ATRIBUIBLE_LABEL[a]}</option>)}</select></div>
              <div><label className="label">Evidencia (enlace)</label><input className="input" type="url" value={f.evidencia_url} onChange={(e) => setF({ ...f, evidencia_url: e.target.value })} placeholder="https://…" /></div>
              <div className="md:col-span-2"><label className="label">Plan de mejora / acción</label><textarea className="input" rows={2} value={f.plan_mejora} onChange={(e) => setF({ ...f, plan_mejora: e.target.value })} /></div>
              <div><label className="label">Responsable</label><select className="input" value={f.responsable_id} onChange={(e) => setF({ ...f, responsable_id: e.target.value })}><option value="">—</option>{usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></div>
              <div><label className="label">Fecha de seguimiento</label><input className="input" type="date" value={f.fecha_seguimiento} onChange={(e) => setF({ ...f, fecha_seguimiento: e.target.value })} /></div>
              {err && <p className="md:col-span-2 text-sm text-red-600">{err}</p>}
              <div className="md:col-span-2 flex justify-between gap-2">
                <div>{m && m.origen !== 'auto' && !manual && <button type="button" className="link-danger text-xs" disabled={busy} onClick={quitarAjuste}>Quitar ajuste</button>}</div>
                <button type="button" className="btn-primary" disabled={busy || (f.ajustar && !f.justificacion_ajuste.trim())} onClick={guardar}>{busy ? 'Guardando…' : 'Guardar'}</button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** Carga el tablero de un mes (lo usan /kpis y el modal de Personas). */
export function useTableroKpis(mes: string, soloMios = false) {
  const [tablero, setTablero] = useState<KpiTablero | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cargar = useCallback(() => {
    setError(null);
    api<KpiTablero>(`/kpis${soloMios ? '/mios' : ''}?periodo=${mes}`).then(setTablero).catch((e) => setError(e instanceof ApiError ? (/kpi_definiciones|does not exist|schema cache/i.test(e.message) ? 'Falta aplicar la migración 22 de KPIs en Supabase.' : e.message) : 'Error cargando KPIs'));
  }, [mes, soloMios]);
  useEffect(() => { cargar(); }, [cargar]);
  return { tablero, error, recargar: cargar };
}
