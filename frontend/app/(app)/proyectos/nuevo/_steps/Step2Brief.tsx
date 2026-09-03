import type { Cliente } from '@backio/shared';
import { CANALES } from '@backio/shared';
import type { WizardState } from '../wizard';

export function Step2Brief({ state: s, set, clientes }: { state: WizardState; set: (p: Partial<WizardState>) => void; clientes: Cliente[] }) {
  const b = s.brief;
  const setB = (p: Partial<WizardState['brief']>) => set({ brief: { ...b, ...p } });
  const toggleCanal = (c: string) => setB({ canales: b.canales.includes(c) ? b.canales.filter((x) => x !== c) : [...b.canales, c] });
  const hoy = new Date().toISOString().slice(0, 10);

  return (
    <div className="card p-6 grid gap-5 md:grid-cols-2">
      <div className="md:col-span-2 text-sm text-gray-500">Brief estructurado: formulario, no texto libre. Se guarda versionado en el proyecto.</div>
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
