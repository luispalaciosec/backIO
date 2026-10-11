'use client';
/** Detalle de un KPI: cómo se calcula, tareas que lo alimentan y registro manual. */
import { useEffect, useState } from 'react';
import type { KpiDefinicion, KpiDetalleTarea, Usuario, Atribuible } from '@backio/shared';
import { AREA_LABEL, ATRIBUIBLE_LABEL, CALCULO_KPI_LABEL } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { fecha, diaLocal } from '@/lib/format';
import { hrefExterno } from '@/lib/url';
import { pct, nombreMes, EstadoKpi, Origen, type Seleccion } from './comun';

export function DetalleKpi({
  sel,
  mes,
  puedeRegistrar,
  usuarios,
  onClose,
  onGuardado,
}: {
  sel: Seleccion;
  mes: string;
  puedeRegistrar: boolean;
  usuarios: Usuario[];
  onClose: () => void;
  onGuardado: () => void;
}) {
  const def: KpiDefinicion = sel.kpi.definicion;
  const m = sel.valor.medicion;
  const manual = def.calculo === 'manual';
  const [tareas, setTareas] = useState<KpiDetalleTarea[] | null>(manual ? [] : null);
  const [f, setF] = useState({
    dato_a: m?.dato_a ?? sel.valor.dato_a ?? '',
    dato_b: m?.dato_b ?? sel.valor.dato_b ?? '',
    ajustar: m?.origen === 'ajustado',
    justificacion_ajuste: m?.justificacion_ajuste ?? '',
    tasa_respuesta: m?.tasa_respuesta !== null && m?.tasa_respuesta !== undefined ? String(Math.round(m.tasa_respuesta * 100)) : '',
    causa: m?.causa ?? '',
    atribuible: (m?.atribuible ?? '') as Atribuible | '',
    evidencia_url: m?.evidencia_url ?? '',
    plan_mejora: m?.plan_mejora ?? '',
    responsable_id: m?.responsable_id ?? '',
    fecha_seguimiento: m?.fecha_seguimiento ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (manual) return;
    api<{ tareas: KpiDetalleTarea[] }>(`/kpis/${def.codigo}?periodo=${mes}${sel.usuarioId ? `&usuario=${sel.usuarioId}` : ''}`)
      .then((r) => setTareas(r.tareas))
      .catch(() => setTareas([]));
  }, [def.codigo, mes, sel.usuarioId, manual]);

  async function guardar() {
    setBusy(true);
    setErr(null);
    const num = (v: string | number) => (v === '' ? null : Number(v));
    const cambiaDatos = manual || f.ajustar;
    try {
      await api(`/kpis/${def.codigo}/mediciones`, {
        method: 'PUT',
        json: {
          mes,
          usuario_id: sel.usuarioId,
          ...(cambiaDatos ? { dato_a: num(f.dato_a), dato_b: num(f.dato_b) } : {}),
          justificacion_ajuste: f.ajustar ? f.justificacion_ajuste.trim() || null : null,
          tasa_respuesta: f.tasa_respuesta === '' ? null : Number(f.tasa_respuesta) / 100,
          causa: f.causa.trim() || null,
          atribuible: f.atribuible || null,
          evidencia_url: f.evidencia_url.trim() || null,
          plan_mejora: f.plan_mejora.trim() || null,
          responsable_id: f.responsable_id || null,
          fecha_seguimiento: f.fecha_seguimiento || null,
        },
      });
      onGuardado();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'No se pudo guardar');
    }
    setBusy(false);
  }
  async function quitarAjuste() {
    if (!m || !confirm('¿Quitar el ajuste y volver al valor calculado por BackIO?')) return;
    setBusy(true);
    try {
      await api(`/kpis/${def.codigo}/mediciones/${m.id}`, { method: 'DELETE' });
      onGuardado();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Error');
    }
    setBusy(false);
  }
  const enA = tareas?.filter((t) => t.cuenta_en_a) ?? [],
    fuera = tareas?.filter((t) => !t.cuenta_en_a) ?? [];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50" onClick={onClose}>
      <div className="card w-full max-w-3xl max-h-[88vh] overflow-auto p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs text-gray-400">
              {def.codigo} · {AREA_LABEL[def.area]} · {CALCULO_KPI_LABEL[def.calculo]}
            </div>
            <div className="font-semibold text-lg">{def.indicador}</div>
            <div className="text-sm text-gray-600">
              {sel.nombre} · {nombreMes(mes)}
              {def.periodicidad === 'trimestral' ? ' (trimestre)' : ''}
            </div>
          </div>
          <button className="btn-ghost" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="text-3xl font-bold tabular-nums">{pct(sel.valor.resultado)}</div>
          <EstadoKpi v={sel.valor} grande />
          <Origen v={sel.valor} />
          <div className="text-sm text-gray-600">
            {sel.valor.dato_a ?? '—'} de {sel.valor.dato_b ?? '—'} · meta {def.operador === '>=' ? '≥' : '≤'} {pct(sel.valor.meta)}
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-2 text-sm">
          <div className="rounded-md bg-gray-50 p-2">
            <div className="text-xs text-gray-500">Dato A</div>
            {def.numerador_label}
          </div>
          <div className="rounded-md bg-gray-50 p-2">
            <div className="text-xs text-gray-500">Dato B</div>
            {def.denominador_label}
          </div>
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
                        <td className="px-2 py-1 w-6">
                          {t.cuenta_en_a ? <span className="text-emerald-600">✓</span> : <span className="text-red-600">✗</span>}
                        </td>
                        <td className="px-2 py-1">
                          {t.titulo}
                          {t.basecamp_url && (
                            <a
                              className="ml-1 font-bold text-emerald-700"
                              href={hrefExterno(t.basecamp_url)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Bc↗
                            </a>
                          )}
                          {t.nota && <span className="ml-1 text-amber-700">· {t.nota}</span>}
                        </td>
                        <td className="px-2 py-1 text-gray-500">{t.cliente}</td>
                        <td className="px-2 py-1 text-gray-500">{t.responsables}</td>
                        <td className="px-2 py-1 text-gray-500 whitespace-nowrap">{fecha(diaLocal(t.fecha))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[11px] text-gray-400 mt-1">
              ✓ cuenta en el dato A · ✗ solo en el dato B. {def.operador === '<=' ? 'En este KPI, menos es mejor.' : ''}
            </p>
          </section>
        )}

        <section className="space-y-3 border-t border-gray-100 pt-3">
          <div className="text-xs uppercase tracking-wide text-gray-500">Seguimiento</div>
          {!puedeRegistrar && (
            <div className="text-sm text-gray-600 space-y-1">
              {m?.causa ? (
                <p>
                  <b>Causa:</b> {m.causa}
                </p>
              ) : null}
              {m?.plan_mejora ? (
                <p>
                  <b>Plan de mejora:</b> {m.plan_mejora}
                </p>
              ) : null}
              {!m?.causa && !m?.plan_mejora && (
                <p className="text-gray-400">Sin seguimiento registrado. Lo registran admin, gerencia u operaciones.</p>
              )}
            </div>
          )}
          {puedeRegistrar && (
            <div className="grid gap-3 md:grid-cols-2">
              {!manual && (
                <label className="md:col-span-2 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={f.ajustar} onChange={(e) => setF({ ...f, ajustar: e.target.checked })} /> Corregir el
                  valor calculado (requiere justificación)
                </label>
              )}
              {(manual || f.ajustar) && (
                <>
                  <div>
                    <label className="label">Dato A</label>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      step="any"
                      value={f.dato_a}
                      onChange={(e) => setF({ ...f, dato_a: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label">Dato B</label>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      step="any"
                      value={f.dato_b}
                      onChange={(e) => setF({ ...f, dato_b: e.target.value })}
                    />
                  </div>
                </>
              )}
              {f.ajustar && (
                <div className="md:col-span-2">
                  <label className="label">Justificación del ajuste *</label>
                  <input
                    className="input"
                    value={f.justificacion_ajuste}
                    onChange={(e) => setF({ ...f, justificacion_ajuste: e.target.value })}
                    placeholder="Por qué el cálculo automático no refleja la realidad"
                  />
                </div>
              )}
              {def.codigo === 'KPI-CUE-02' && (
                <div>
                  <label className="label">Tasa de respuesta de la encuesta (%)</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={100}
                    value={f.tasa_respuesta}
                    onChange={(e) => setF({ ...f, tasa_respuesta: e.target.value })}
                  />
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {f.tasa_respuesta === '' ? '' : Number(f.tasa_respuesta) >= 70 ? 'Muestra válida' : 'Muestra insuficiente (<70%)'}
                  </p>
                </div>
              )}
              <div className="md:col-span-2">
                <label className="label">Causa / observación</label>
                <textarea className="input" rows={2} value={f.causa} onChange={(e) => setF({ ...f, causa: e.target.value })} />
              </div>
              <div>
                <label className="label">Atribuible</label>
                <select
                  className="input"
                  value={f.atribuible}
                  onChange={(e) => setF({ ...f, atribuible: e.target.value as Atribuible | '' })}
                >
                  <option value="">—</option>
                  {(Object.keys(ATRIBUIBLE_LABEL) as Atribuible[]).map((a) => (
                    <option key={a} value={a}>
                      {ATRIBUIBLE_LABEL[a]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Evidencia (enlace)</label>
                <input
                  className="input"
                  type="url"
                  value={f.evidencia_url}
                  onChange={(e) => setF({ ...f, evidencia_url: e.target.value })}
                  placeholder="https://…"
                />
              </div>
              <div className="md:col-span-2">
                <label className="label">Plan de mejora / acción</label>
                <textarea className="input" rows={2} value={f.plan_mejora} onChange={(e) => setF({ ...f, plan_mejora: e.target.value })} />
              </div>
              <div>
                <label className="label">Responsable</label>
                <select className="input" value={f.responsable_id} onChange={(e) => setF({ ...f, responsable_id: e.target.value })}>
                  <option value="">—</option>
                  {usuarios.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Fecha de seguimiento</label>
                <input
                  className="input"
                  type="date"
                  value={f.fecha_seguimiento}
                  onChange={(e) => setF({ ...f, fecha_seguimiento: e.target.value })}
                />
              </div>
              {err && <p className="md:col-span-2 text-sm text-red-600">{err}</p>}
              <div className="md:col-span-2 flex justify-between gap-2">
                <div>
                  {m && m.origen !== 'auto' && !manual && (
                    <button type="button" className="link-danger text-xs" disabled={busy} onClick={quitarAjuste}>
                      Quitar ajuste
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy || (f.ajustar && !f.justificacion_ajuste.trim())}
                  onClick={guardar}
                >
                  {busy ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** Carga el tablero de un mes (lo usan /kpis y el modal de Personas). */
