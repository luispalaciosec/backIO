'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Proyecto } from '@backio/shared';
import { api } from '@/lib/api';

export function PortalControls({ proyecto }: { proyecto: Proyecto }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
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
        {proyecto.sync_estado !== 'ok' && <button className="btn-ghost text-xs" disabled={busy} onClick={reintentar}>Reintentar Basecamp</button>}
      </div>
    </div>
  );
}
