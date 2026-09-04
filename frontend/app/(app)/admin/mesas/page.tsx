'use client';
import { useEffect, useState, type FormEvent } from 'react';
import type { Mesa, Usuario, Cliente } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';

export default function AdminMesasPage() {
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nueva, setNueva] = useState({ nombre: '', basecamp_project_id: '' });

  const cargar = async () => {
    try {
      const [m, u, c] = await Promise.all([api<{ items: Mesa[] }>('/mesas'), api<{ items: Usuario[] }>('/usuarios'), api<{ items: Cliente[] }>('/clientes?todos=1')]);
      setMesas(m.items); setUsuarios(u.items); setClientes(c.items);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
  };
  useEffect(() => { void cargar(); }, []);

  async function patchMesa(id: string, body: Record<string, unknown>) {
    setError(null);
    try { await api(`/mesas/${id}`, { method: 'PATCH', json: body }); await cargar(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
  }
  async function asignarCliente(clienteId: string, mesaId: string | null) {
    setError(null);
    try { await api(`/clientes/${clienteId}`, { method: 'PATCH', json: { mesa_id: mesaId } }); await cargar(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
  }
  async function crear(e: FormEvent) {
    e.preventDefault(); setError(null);
    try {
      await api('/mesas', { method: 'POST', json: { nombre: nueva.nombre, basecamp_project_id: nueva.basecamp_project_id ? Number(nueva.basecamp_project_id) : null } });
      setNueva({ nombre: '', basecamp_project_id: '' }); await cargar();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
  }

  return (
    <div className="max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Mesas</h1>
        <p className="text-sm text-gray-500">Equipos de cuenta. Cada mesa maneja clientes y tiene su proyecto Basecamp con dos boards: Daily (apertura/cierre) y Weekly (status semanal). Ahí publica BackIO.</p>
      </header>
      {error && <Alert tipo="error">{error}</Alert>}

      <div className="grid gap-4 md:grid-cols-2">
        {mesas.map((m) => {
          const suyos = clientes.filter((c) => c.mesa_id === m.id);
          return (
            <section key={m.id} className="card overflow-hidden">
              <div className="px-4 py-3 text-white font-semibold flex items-center justify-between" style={{ backgroundColor: m.color ?? '#0073EA' }}>
                <span>{m.nombre}</span>
                <label className="text-xs font-normal flex items-center gap-1"><input type="checkbox" checked={m.activa} onChange={(e) => patchMesa(m.id, { activa: e.target.checked })} /> activa</label>
              </div>
              <div className="p-4 space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="label">Basecamp project id (actas)</label><input className="input" inputMode="numeric" defaultValue={m.basecamp_project_id ?? ''} onBlur={(e) => { const v = e.target.value.trim(); const n = v ? Number(v) : null; if (n !== m.basecamp_project_id) void patchMesa(m.id, { basecamp_project_id: n }); }} /></div>
                  <div><label className="label">Líder</label>
                    <select className="input" value={m.lider_id ?? ''} onChange={(e) => patchMesa(m.id, { lider_id: e.target.value || null })}>
                      <option value="">—</option>{usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                    </select></div>
                  <div><label className="label">Color</label><input type="color" className="input h-9 p-1" defaultValue={m.color ?? '#0073EA'} onBlur={(e) => e.target.value !== m.color && patchMesa(m.id, { color: e.target.value })} /></div>
                  <div><label className="label">Board Daily (id)</label><input className="input" inputMode="numeric" defaultValue={m.basecamp_board_daily_id ?? ''} onBlur={(e) => { const v = e.target.value.trim(); const n = v ? Number(v) : null; if (n !== m.basecamp_board_daily_id) void patchMesa(m.id, { basecamp_board_daily_id: n }); }} /></div>
                  <div><label className="label">Board Weekly (id)</label><input className="input" inputMode="numeric" defaultValue={m.basecamp_board_weekly_id ?? ''} onBlur={(e) => { const v = e.target.value.trim(); const n = v ? Number(v) : null; if (n !== m.basecamp_board_weekly_id) void patchMesa(m.id, { basecamp_board_weekly_id: n }); }} /></div>
                  <div className="flex items-end"><button type="button" className="btn-secondary w-full" disabled={!m.basecamp_project_id} title="Lee el proyecto Basecamp de la mesa y detecta los boards Daily y Weekly" onClick={async () => {
                    setError(null);
                    try { const r = await api<{ daily: number | null; weekly: number | null; boards: { id: number; title: string }[] }>(`/mesas/${m.id}/basecamp/detectar-boards`, { method: 'POST' }); alert(`Boards: ${r.boards.map((b) => `${b.title} (${b.id})`).join(', ') || 'ninguno'}\nDaily → ${r.daily ?? 'no detectado'} · Weekly → ${r.weekly ?? 'no detectado'}`); await cargar(); }
                    catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
                  }}>Detectar boards</button></div>
                </div>
                <div>
                  <div className="label">Clientes ({suyos.length})</div>
                  <ul className="divide-y divide-gray-100">
                    {suyos.map((c) => (
                      <li key={c.id} className="py-1.5 flex justify-between items-center"><span>{c.nombre}</span><button className="link-danger" onClick={() => asignarCliente(c.id, null)}>quitar</button></li>
                    ))}
                    {suyos.length === 0 && <li className="py-1.5 text-gray-400">Sin clientes asignados.</li>}
                  </ul>
                  <select className="input mt-2" value="" onChange={(e) => e.target.value && asignarCliente(e.target.value, m.id)}>
                    <option value="">+ Asignar cliente…</option>
                    {clientes.filter((c) => c.mesa_id !== m.id).map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.mesa_id ? ` (en ${mesas.find((x) => x.id === c.mesa_id)?.nombre ?? 'otra mesa'})` : ''}</option>)}
                  </select>
                </div>
              </div>
            </section>
          );
        })}
      </div>

      <form onSubmit={crear} className="card p-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-48"><label className="label">Nueva mesa</label><input className="input" required placeholder="Mesa Sigma" value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} /></div>
        <div className="min-w-48"><label className="label">Basecamp project id</label><input className="input" inputMode="numeric" value={nueva.basecamp_project_id} onChange={(e) => setNueva({ ...nueva, basecamp_project_id: e.target.value })} /></div>
        <button className="btn-primary">Crear mesa</button>
      </form>
      <p className="text-xs text-gray-500">Un proyecto puede llevarlo otra mesa distinta a la de su cliente: se cambia en el detalle del proyecto.</p>
    </div>
  );
}
