'use client';
import { useEffect, useState } from 'react';
import type { RequerimientoMetricas, HistorialRequerimiento, MotivoReproceso, MotivoReprogramacion } from '@backio/shared';
import { MOTIVOS_REPROCESO, MOTIVOS_REPROGRAMACION, PASOS_RETORNO } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { fecha } from '@/lib/format';

const labelRp = (m: string | null) => MOTIVOS_REPROGRAMACION.find((x) => x.valor === m)?.label ?? 'Sin causa';
const labelRc = (m: string | null) => MOTIVOS_REPROCESO.find((x) => x.valor === m)?.label ?? 'Sin causa';
const ORIGEN: Record<string, string> = { cliente: 'Cliente', interno: 'Revisión interna', basecamp: 'Desmarcado en Basecamp' };

/** Botón ↺ en la fila: registrar reproceso, ver historial de reprogramaciones/reprocesos y completar causas. */
export function HistorialReq({ r, onCambio }: { r: RequerimientoMetricas; onCambio: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const tiene = r.veces_reprogramado > 0 || (r.veces_reproceso ?? 0) > 0;
  return (
    <>
      <button type="button" className={`text-xs shrink-0 px-1 ${tiene ? 'text-amber-700 font-semibold' : 'text-gray-300 hover:text-gray-600'}`} title={`Reprogramaciones: ${r.veces_reprogramado} · Reprocesos: ${r.veces_reproceso ?? 0}. Clic para historial y reproceso`} onClick={(e) => { e.stopPropagation(); setAbierto(true); }}>
        ↺{tiene ? `${r.veces_reprogramado}/${r.veces_reproceso ?? 0}` : ''}
      </button>
      {abierto && <Modal r={r} onClose={() => setAbierto(false)} onCambio={onCambio} />}
    </>
  );
}

function Modal({ r, onClose, onCambio }: { r: RequerimientoMetricas; onClose: () => void; onCambio: () => void }) {
  const [h, setH] = useState<HistorialRequerimiento | null>(null);
  const [tab, setTab] = useState<'historial' | 'reproceso'>('historial');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<{ origen: 'cliente' | 'interno'; motivo: MotivoReproceso | ''; paso: string; reabrir: boolean }>({ origen: 'cliente', motivo: '', paso: '', reabrir: true });
  const cargar = () => api<HistorialRequerimiento>(`/requerimientos/${r.id}/historial`).then(setH).catch((e) => setErr(e instanceof ApiError ? e.message : 'Error'));
  useEffect(() => { void cargar(); }, [r.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const abiertoRp = h?.reprocesos.find((x) => !x.cerrado_at);
  const hecho = r.estado_operativo === 'completado' || r.estado_operativo === 'cancelado';

  async function registrar() {
    if (!f.motivo) return;
    setBusy(true); setErr(null);
    try { await api(`/requerimientos/${r.id}/reprocesos`, { method: 'POST', json: { origen: f.origen, motivo: f.motivo, paso_retorno: f.paso || null, reabrir_basecamp: f.reabrir } }); await cargar(); onCambio(); setTab('historial'); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Error'); }
    setBusy(false);
  }
  async function patchRp(id: string, motivo: MotivoReprogramacion) {
    try { await api(`/requerimientos/reprogramaciones/${id}`, { method: 'PATCH', json: { motivo } }); await cargar(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Error'); }
  }
  async function patchRc(id: string, motivo: MotivoReproceso) {
    try { await api(`/requerimientos/${r.id}/reprocesos/${id}`, { method: 'PATCH', json: { motivo } }); await cargar(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Error'); }
  }
  async function cerrar(id: string) {
    setBusy(true);
    try { await api(`/requerimientos/${r.id}/reprocesos/${id}/cerrar`, { method: 'POST' }); await cargar(); onCambio(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Error'); }
    setBusy(false);
  }
  const info = MOTIVOS_REPROCESO.find((m) => m.valor === f.motivo);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50" onClick={onClose}>
      <div className="card w-full max-w-2xl max-h-[85vh] overflow-auto p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-semibold">{r.titulo_interno}</div>
            <div className="text-xs text-gray-500 mt-1">Comprometida {fecha(r.fecha_entrega_original)}{r.fecha_entrega !== r.fecha_entrega_original ? <> · vigente <b>{fecha(r.fecha_entrega)}</b></> : null} · {r.veces_reprogramado} reprogramaciones · {r.veces_reproceso ?? 0} reprocesos</div>
          </div>
          <button className="btn-ghost" onClick={onClose}>×</button>
        </div>
        <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5 text-sm">
          <button className={`px-3 py-1 rounded ${tab === 'historial' ? 'bg-brand text-white' : 'text-gray-600'}`} onClick={() => setTab('historial')}>Historial</button>
          <button className={`px-3 py-1 rounded ${tab === 'reproceso' ? 'bg-brand text-white' : 'text-gray-600'}`} onClick={() => setTab('reproceso')} disabled={!!abiertoRp}>{abiertoRp ? 'Reproceso abierto' : '⟲ Registrar reproceso'}</button>
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}

        {tab === 'reproceso' && !abiertoRp && (
          <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm text-amber-900">El entregable vuelve al equipo. La tarea pasa a «En ejecución»{r.basecamp_todo_id ? ' y el to-do se reabre en Basecamp' : ''}. Se registra la causa, nunca el comentario.</p>
            <div className="grid gap-3 md:grid-cols-2">
              <div><label className="label">Quién lo pide</label><select className="input" value={f.origen} onChange={(e) => setF({ ...f, origen: e.target.value as 'cliente' | 'interno' })}><option value="cliente">Cliente</option><option value="interno">Revisión interna</option></select></div>
              <div><label className="label">Causa *</label><select className="input" value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value as MotivoReproceso })}><option value="">Selecciona…</option>{MOTIVOS_REPROCESO.map((m) => <option key={m.valor} value={m.valor}>{m.label}</option>)}</select>{info && <p className="text-xs text-gray-600 mt-1">Responsable natural: {info.responsable}.</p>}</div>
              <div><label className="label">Regresa al paso</label><select className="input" value={f.paso} onChange={(e) => setF({ ...f, paso: e.target.value })}><option value="">No aplica / pieza simple</option>{PASOS_RETORNO.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
              {r.basecamp_todo_id && <label className="flex items-center gap-2 text-sm self-end pb-2"><input type="checkbox" checked={f.reabrir} onChange={(e) => setF({ ...f, reabrir: e.target.checked })} /> Reabrir el to-do en Basecamp</label>}
            </div>
            <div className="flex justify-end"><button className="btn-danger" disabled={!f.motivo || busy} onClick={registrar}>{busy ? 'Registrando…' : '⟲ Registrar reproceso'}</button></div>
          </div>
        )}

        {tab === 'historial' && (
          <div className="space-y-4">
            {abiertoRp && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm flex items-center justify-between gap-3">
                <span><b>Reproceso abierto</b> desde {fecha(abiertoRp.abierto_at.slice(0, 10))} · {ORIGEN[abiertoRp.origen]} · {labelRc(abiertoRp.motivo)}{abiertoRp.paso_retorno ? ` · vuelve a ${abiertoRp.paso_retorno}` : ''}</span>
                {!hecho && <button className="btn-success text-xs py-1" disabled={busy} onClick={() => cerrar(abiertoRp.id)}>Entregado de nuevo</button>}
              </div>
            )}
            <section>
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Reprogramaciones</div>
              {!h && <p className="text-sm text-gray-400">Cargando…</p>}
              {h && h.reprogramaciones.length === 0 && <p className="text-sm text-gray-400">Nunca se movió la fecha.</p>}
              {h && h.reprogramaciones.length > 0 && (
                <table className="w-full text-sm"><thead><tr><th className="th">Cuándo</th><th className="th">De</th><th className="th">A</th><th className="th">Causa</th><th className="th">Origen</th></tr></thead>
                  <tbody>{h.reprogramaciones.map((x) => (
                    <tr key={x.id}><td className="td whitespace-nowrap text-gray-500">{fecha(x.created_at.slice(0, 10))}</td><td className="td line-through text-gray-500">{fecha(x.fecha_anterior)}</td><td className="td font-medium">{fecha(x.fecha_nueva)}</td>
                      <td className="td">{x.motivo ? labelRp(x.motivo) : <select className="input py-1 text-xs border-amber-300" defaultValue="" onChange={(e) => e.target.value && patchRp(x.id, e.target.value as MotivoReprogramacion)}><option value="">Sin causa · completar…</option>{MOTIVOS_REPROGRAMACION.map((m) => <option key={m.valor} value={m.valor}>{m.label}</option>)}</select>}</td>
                      <td className="td text-xs text-gray-500">{x.origen}</td></tr>
                  ))}</tbody></table>
              )}
            </section>
            <section>
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Reprocesos</div>
              {h && h.reprocesos.length === 0 && <p className="text-sm text-gray-400">Bien a la primera, por ahora.</p>}
              {h && h.reprocesos.length > 0 && (
                <table className="w-full text-sm"><thead><tr><th className="th">Abierto</th><th className="th">Origen</th><th className="th">Causa</th><th className="th">Paso</th><th className="th">Cerrado</th><th className="th text-right">Horas</th></tr></thead>
                  <tbody>{h.reprocesos.map((x) => (
                    <tr key={x.id}><td className="td whitespace-nowrap text-gray-500">{fecha(x.abierto_at.slice(0, 10))}</td><td className="td">{ORIGEN[x.origen]}</td>
                      <td className="td">{x.motivo ? labelRc(x.motivo) : <select className="input py-1 text-xs border-amber-300" defaultValue="" onChange={(e) => e.target.value && patchRc(x.id, e.target.value as MotivoReproceso)}><option value="">Sin causa · completar…</option>{MOTIVOS_REPROCESO.map((m) => <option key={m.valor} value={m.valor}>{m.label}</option>)}</select>}</td>
                      <td className="td text-xs">{x.paso_retorno ?? '—'}</td><td className="td whitespace-nowrap text-gray-500">{x.cerrado_at ? fecha(x.cerrado_at.slice(0, 10)) : <span className="text-red-700">abierto</span>}</td><td className="td text-right tabular-nums">{x.horas_reproceso ?? ''}</td></tr>
                  ))}</tbody></table>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
