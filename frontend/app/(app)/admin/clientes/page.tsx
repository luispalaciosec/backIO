'use client';
import { useEffect, useState } from 'react';
import type { Cliente } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';

export default function AdminClientesPage() {
  const [items, setItems] = useState<Cliente[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const cargar = () => api<{ items: Cliente[] }>('/clientes?todos=1').then((r) => setItems(r.items)).catch((e) => setError(e instanceof ApiError ? e.message : 'Error'));
  useEffect(() => { void cargar(); }, []);

  async function guardar(c: Cliente, form: FormData) {
    setError(null); setOk(null);
    const bc = String(form.get('basecamp_project_id') ?? '').trim();
    const pin = String(form.get('portal_pin') ?? '').trim();
    try {
      await api(`/clientes/${c.id}`, { method: 'PATCH', json: {
        basecamp_project_id: bc ? Number(bc) : null,
        color_primario: String(form.get('color_primario') || '#0073EA'),
        logo_url: String(form.get('logo_url') || '') || null,
        config: { ...(c.config ?? {}), portal_pin: pin || null },
      } });
      setOk(`${c.nombre} actualizado`);
      await cargar();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
  }

  return (
    <div className="max-w-5xl space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Clientes</h1>
        <p className="text-sm text-gray-500">Vienen de PrometIO con el mismo id. Aquí solo se configura lo que PrometIO no conoce: proyecto de Basecamp, branding del portal y PIN.</p>
      </header>
      {error && <Alert tipo="error">{error}</Alert>}
      {ok && <Alert tipo="ok">{ok}</Alert>}
      <div className="space-y-3">
        {items.map((c) => (
          <form key={c.id} className="card p-4 grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_0.7fr_0.6fr_auto] items-end" action={(fd) => guardar(c, fd)}>
            <div>
              <div className="font-semibold">{c.nombre} {!c.activo && <span className="text-xs text-gray-400">(inactivo)</span>}</div>
              <div className="text-xs text-gray-400 font-mono">{c.id}</div>
            </div>
            <div><label className="label">Basecamp project id</label><input name="basecamp_project_id" className="input" inputMode="numeric" defaultValue={c.basecamp_project_id ?? ''} placeholder="Ej. 12345678" /></div>
            <div><label className="label">Logo URL</label><input name="logo_url" className="input" defaultValue={c.logo_url ?? ''} /></div>
            <div><label className="label">Color</label><input name="color_primario" type="color" className="input h-9 p-1" defaultValue={c.color_primario ?? '#0073EA'} /></div>
            <div><label className="label">PIN portal</label><input name="portal_pin" className="input" maxLength={6} defaultValue={String((c.config as { portal_pin?: string })?.portal_pin ?? '')} placeholder="opcional" /></div>
            <button className="btn-primary">Guardar</button>
          </form>
        ))}
        {items.length === 0 && <div className="card p-6 text-gray-500">Sin clientes. Llegan desde PrometIO por webhook.</div>}
      </div>
      <p className="text-xs text-gray-500">El id del proyecto en Basecamp es el número de la URL: <code>3.basecamp.com/&lt;cuenta&gt;/projects/<b>&lt;id&gt;</b></code>.</p>
    </div>
  );
}
