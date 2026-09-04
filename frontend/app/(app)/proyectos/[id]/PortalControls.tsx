'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Proyecto, Mesa } from '@backio/shared';
import { useEffect } from 'react';
import { api } from '@/lib/api';

export function PortalControls({ proyecto }: { proyecto: Proyecto }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  useEffect(() => { api<{ items: Mesa[] }>('/mesas').then((r) => setMesas(r.items)).catch(() => {}); }, []);
  const url = typeof window !== 'undefined' && proyecto.portal_token ? `${window.location.origin}/p/${proyecto.portal_token}` : null;

  async function toggle() {
    setBusy(true);
    await api(`/proyectos/${proyecto.id}`, { method: 'PATCH', json: { portal_activo: !proyecto.portal_activo } });
    setBusy(false);
    router.refresh();
  }
  async function rotar() {
    if (!confirm('Rotar el token invalida el enlace actual del cliente. ¿Continuar?')) return;
    setBusy(true);
    await api(`/proyectos/${proyecto.id}/portal/rotar`, { method: 'POST' });
    setBusy(false);
    router.refresh();
  }
  async function comoPlantilla() {
    const nombre = prompt('Nombre de la plantilla nueva:', proyecto.nombre);
    if (!nombre) return;
    const solo = confirm('¿Solo para este cliente? Aceptar = del cliente · Cancelar = general para toda la agencia');
    setBusy(true);
    try { const p = await api<{ id: string; nombre: string }>(`/plantillas/desde-proyecto/${proyecto.id}`, { method: 'POST', json: { nombre, solo_cliente: solo } }); alert(`Plantilla "${p.nombre}" creada. Edítala en Admin → Plantillas.`); }
    catch (e) { alert(e instanceof Error ? e.message : 'Error'); }
    setBusy(false);
  }
  async function repetir() {
    if (!confirm(`Crear la recurrencia mensual a partir de "${proyecto.nombre}". Cada día 25 BackIO generará el mes siguiente con los mismos bloques, piezas y responsables. ¿Continuar?`)) return;
    setBusy(true);
    try { await api(`/recurrencias/desde-proyecto/${proyecto.id}`, { method: 'POST', json: {} }); alert('Recurrencia creada. Revísala en Admin → Recurrencias.'); router.refresh(); }
    catch (e) { alert(e instanceof Error ? e.message : 'Error'); }
    setBusy(false);
  }
  async function reintentar() {
    setBusy(true);
    try {
      const r = await api<{ creados: number; fallidos: number }>(`/proyectos/${proyecto.id}/basecamp/reintentar`, { method: 'POST' });
      alert(`Basecamp: ${r.creados} creados, ${r.fallidos} fallidos`);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error');
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="card p-3 text-sm space-y-2 min-w-64">
      <div className="flex items-center justify-between gap-3">
        <span>Mesa</span>
        <select className="input w-40" value={proyecto.mesa_id ?? ''} disabled={busy} onChange={async (e) => { setBusy(true); await api(`/proyectos/${proyecto.id}`, { method: 'PATCH', json: { mesa_id: e.target.value || null } }); setBusy(false); router.refresh(); }}>
          <option value="">La del cliente</option>
          {mesas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
        </select>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span>Portal cliente</span>
        <button className={proyecto.portal_activo ? 'btn-secondary' : 'btn-primary'} disabled={busy} onClick={toggle}>
          {proyecto.portal_activo ? 'Desactivar' : 'Activar'}
        </button>
      </div>
      {proyecto.portal_activo && url && (
        <div className="flex gap-2">
          <input className="input text-xs" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          <button className="btn-ghost text-xs" onClick={() => navigator.clipboard.writeText(url)}>Copiar</button>
        </div>
      )}
      <div className="flex gap-2">
        <button className="btn-ghost text-xs" disabled={busy} onClick={rotar}>Rotar token</button>
        <button className="btn-ghost text-xs" disabled={busy} onClick={comoPlantilla}>Guardar como plantilla</button>
        {proyecto.plantilla_id && !proyecto.recurrencia_id && <button className="btn-ghost text-xs" disabled={busy} onClick={repetir} title="Fee mensual: generar automáticamente el mes siguiente">↻ Repetir cada mes</button>}
        {proyecto.recurrencia_id && <span className="text-xs text-brand" title={`Periodo ${proyecto.periodo ?? ''}`}>↻ Fee mensual{proyecto.periodo ? ` · ${proyecto.periodo}` : ''}</span>}
        {proyecto.sync_estado !== 'ok' && <button className="btn-ghost text-xs" disabled={busy} onClick={reintentar}>Reintentar Basecamp</button>}
      </div>
    </div>
  );
}
