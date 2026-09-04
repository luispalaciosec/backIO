import { useState } from 'react';
import type { Cliente, BriefIA } from '@backio/shared';
import { CANALES } from '@backio/shared';
import type { WizardState } from '../wizard';
import { api, ApiError } from '@/lib/api';
import { useIA } from '@/lib/useIA';

export function Step2Brief({ state: s, set, clientes, onSugerirPlantilla }: { state: WizardState; set: (p: Partial<WizardState>) => void; clientes: Cliente[]; onSugerirPlantilla?: (id: string) => Promise<void> }) {
  const ia = useIA();
  const [pegado, setPegado] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<BriefIA | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const b = s.brief;
  const setB = (p: Partial<WizardState['brief']>) => set({ brief: { ...b, ...p } });
  const toggleCanal = (c: string) => setB({ canales: b.canales.includes(c) ? b.canales.filter((x) => x !== c) : [...b.canales, c] });
  const hoy = new Date().toISOString().slice(0, 10);

  return (
    <div className="card p-6 grid gap-5 md:grid-cols-2">
      <div className="md:col-span-2 flex items-center justify-between gap-3 flex-wrap">
        <span className="text-sm text-gray-500">Brief estructurado: formulario, no texto libre. Se guarda versionado en el proyecto.</span>
        {ia && <button type="button" className="btn-secondary text-xs" onClick={() => setAbierto((v) => !v)}>✨ Pegar correo del cliente</button>}
      </div>
      {ia && abierto && (
        <div className="md:col-span-2 rounded-md border border-violet-200 bg-violet-50 p-3 space-y-2">
          <textarea className="input text-sm" rows={6} placeholder="Pega aquí el correo, mensaje o notas del cliente. La IA llena el brief, sugiere plantilla y cuenta las piezas. Nada se guarda hasta que crees el proyecto." value={pegado} onChange={(e) => setPegado(e.target.value)} />
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" className="btn-primary text-xs" disabled={busy || pegado.trim().length < 20} onClick={async () => {
              setBusy(true); setErr(null); setRes(null);
              try {
                const r = await api<BriefIA>('/ia/brief', { method: 'POST', json: { texto: pegado, cliente_id: s.cliente_id || null } });
                setRes(r);
                set({
                  nombre: s.nombre || r.nombre_proyecto || '',
                  fecha_entrega: s.fecha_entrega || r.fecha_entrega || '',
                  piezas_sugeridas: r.piezas_por_tipo,
                  brief: { ...b, objetivo_negocio: r.objetivo_negocio || b.objetivo_negocio, publico_objetivo: r.publico_objetivo || b.publico_objetivo, canales: r.canales.length ? r.canales : b.canales, mandatorios_marca: r.mandatorios_marca ?? b.mandatorios_marca, presupuesto_aprobado: r.presupuesto_aprobado ?? b.presupuesto_aprobado },
                });
              } catch (e) { setErr(e instanceof ApiError ? e.message : 'Error'); }
              setBusy(false);
            }}>{busy ? 'Leyendo…' : 'Extraer brief'}</button>
            {err && <span className="text-xs text-red-600">{err}</span>}
          </div>
          {res && (
            <div className="text-xs text-violet-900 space-y-1">
              <div>Brief cargado en el formulario. Revisa cada campo antes de continuar.</div>
              {res.plantilla_sugerida_id && res.plantilla_sugerida_id !== s.plantilla?.id && onSugerirPlantilla && (
                <div>Plantilla sugerida: <b>{res.plantilla_sugerida_nombre}</b> (elegiste {s.plantilla?.nombre}). <button type="button" className="link-action" onClick={() => onSugerirPlantilla(res.plantilla_sugerida_id!)}>Cambiar a la sugerida</button></div>
              )}
              {Object.keys(res.piezas_por_tipo).length > 0 && <div>Piezas detectadas: {Object.values(res.piezas_por_tipo).reduce((a, n) => a + n, 0)}. Se te recordarán en el paso de alcance.</div>}
              {res.dudas.length > 0 && <div>Preguntar al cliente antes de arrancar:<ul className="list-disc pl-4">{res.dudas.map((d) => <li key={d}>{d}</li>)}</ul></div>}
            </div>
          )}
        </div>
      )}
      <div>
        <label className="label">Cliente *</label>
        <select className="input" value={s.cliente_id} onChange={(e) => set({ cliente_id: e.target.value })}>
          <option value="">Selecciona…</option>
          {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}{!c.basecamp_project_id ? ' (sin Basecamp)' : ''}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Nombre del proyecto *</label>
        <input className="input" value={s.nombre} onChange={(e) => set({ nombre: e.target.value })} placeholder="Campaña Navidad 2026" />
      </div>
      <div className="md:col-span-2">
        <label className="label">Objetivo de negocio *</label>
        <textarea className="input" rows={2} value={b.objetivo_negocio} onChange={(e) => setB({ objetivo_negocio: e.target.value })} />
      </div>
      <div className="md:col-span-2">
        <label className="label">Público objetivo *</label>
        <textarea className="input" rows={2} value={b.publico_objetivo} onChange={(e) => setB({ publico_objetivo: e.target.value })} />
      </div>
      <div className="md:col-span-2">
        <label className="label">Canales *</label>
        <div className="flex flex-wrap gap-2">
          {CANALES.map((c) => (
            <button type="button" key={c} onClick={() => toggleCanal(c)} className={`rounded-full border px-3 py-1 text-sm ${b.canales.includes(c) ? 'bg-brand text-white border-brand' : 'bg-white border-gray-300'}`}>{c}</button>
          ))}
        </div>
      </div>
      <div className="md:col-span-2">
        <label className="label">Mandatorios de marca</label>
        <textarea className="input" rows={2} value={b.mandatorios_marca ?? ''} onChange={(e) => setB({ mandatorios_marca: e.target.value })} />
      </div>
      <div>
        <label className="label">Fecha de entrega final *</label>
        <input className="input" type="date" min={hoy} value={s.fecha_entrega} onChange={(e) => set({ fecha_entrega: e.target.value })} />
      </div>
      <div>
        <label className="label">Presupuesto aprobado (USD)</label>
        <input className="input" type="number" min={0} step="0.01" value={b.presupuesto_aprobado ?? ''} onChange={(e) => setB({ presupuesto_aprobado: e.target.value === '' ? null : Number(e.target.value) })} />
      </div>
      <div>
        <label className="label">Cotización PrometIO (uuid)</label>
        <input className="input" value={s.prometio_cotizacion_id ?? ''} onChange={(e) => set({ prometio_cotizacion_id: e.target.value || null })} placeholder="Opcional" />
      </div>
    </div>
  );
}
