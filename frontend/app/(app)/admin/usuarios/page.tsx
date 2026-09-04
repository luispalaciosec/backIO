'use client';
import { useEffect, useState, type FormEvent } from 'react';
import type { Usuario, Rol } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';

const ROLES: Rol[] = ['admin', 'gerencia', 'operaciones', 'ejecutiva', 'lider', 'colaborador'];
interface Invitacion { id: string; email: string; nombre: string; rol: Rol; capacidad_semanal: number; usada_at: string | null }

export default function AdminUsuariosPage() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [invitaciones, setInvitaciones] = useState<Invitacion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [inv, setInv] = useState({ email: '', nombre: '', rol: 'colaborador' as Rol, capacidad_semanal: 40 });

  const cargar = async () => {
    try {
      const [u, i] = await Promise.all([api<{ items: Usuario[] }>('/admin/usuarios'), api<{ items: Invitacion[] }>('/admin/invitaciones')]);
      setUsuarios(u.items); setInvitaciones(i.items);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
  };
  useEffect(() => { void cargar(); }, []);

  async function patch(id: string, body: Record<string, unknown>) {
    setError(null);
    try { await api(`/admin/usuarios/${id}`, { method: 'PATCH', json: body }); await cargar(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
  }
  async function invitar(e: FormEvent) {
    e.preventDefault(); setError(null);
    try {
      const r = await api<{ envio?: { enviado: boolean; error?: string; url?: string } }>('/admin/invitaciones', { method: 'POST', json: inv });
      if (r.envio && !r.envio.enviado) setError(`Invitación guardada pero el correo no salió: ${r.envio.error ?? 'error'}${r.envio.url ? `. Enlace: ${r.envio.url}` : ''}`);
      setInv({ email: '', nombre: '', rol: 'colaborador', capacidad_semanal: 40 }); await cargar();
    }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
  }

  return (
    <div className="max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Usuarios</h1>
        <p className="text-sm text-gray-500">Al guardar una invitación se crea la cuenta y la persona recibe un correo para definir su contraseña. Entra con el rol indicado; un correo @geeks sin invitación entra como colaborador.</p>
      </header>
      {error && <Alert tipo="error">{error}</Alert>}

      <section className="card overflow-x-auto">
        <table className="w-full min-w-[820px]">
          <thead><tr><th className="th">Nombre</th><th className="th">Email</th><th className="th">Rol</th><th className="th">Capacidad h/sem</th><th className="th">Basecamp user id</th><th className="th">Activo</th></tr></thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id}>
                <td className="td font-medium">{u.nombre}</td>
                <td className="td text-gray-600">{u.email}</td>
                <td className="td"><select className="input" defaultValue={u.rol} onChange={(e) => patch(u.id, { rol: e.target.value })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></td>
                <td className="td"><input className="input w-20" type="number" min={1} max={80} defaultValue={u.capacidad_semanal} onBlur={(e) => Number(e.target.value) !== u.capacidad_semanal && patch(u.id, { capacidad_semanal: Number(e.target.value) })} /></td>
                <td className="td"><input className="input w-36" inputMode="numeric" defaultValue={u.basecamp_user_id ?? ''} placeholder="opcional" onBlur={(e) => { const v = e.target.value.trim(); const n = v ? Number(v) : null; if (n !== u.basecamp_user_id) void patch(u.id, { basecamp_user_id: n }); }} /></td>
                <td className="td"><input type="checkbox" checked={u.activo} onChange={(e) => patch(u.id, { activo: e.target.checked })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
        <form onSubmit={invitar} className="card p-4 space-y-3">
          <div className="font-semibold">Invitar (pre-asignar rol)</div>
          <input className="input" type="email" placeholder="persona@geeks.com.ec" required value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} />
          <input className="input" placeholder="Nombre" required value={inv.nombre} onChange={(e) => setInv({ ...inv, nombre: e.target.value })} />
          <div className="flex gap-2">
            <select className="input" value={inv.rol} onChange={(e) => setInv({ ...inv, rol: e.target.value as Rol })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
            <input className="input w-24" type="number" min={1} max={80} value={inv.capacidad_semanal} onChange={(e) => setInv({ ...inv, capacidad_semanal: Number(e.target.value) })} />
          </div>
          <button className="btn-primary w-full">Guardar invitación</button>
          <p className="text-xs text-gray-500">Se crea la cuenta y se envía el correo con el enlace para definir contraseña (vence en 24 h). Si no llega, usa “reenviar”.</p>
        </form>
        <div className="card p-4">
          <div className="font-semibold mb-2">Invitaciones</div>
          <ul className="divide-y divide-gray-100 text-sm">
            {invitaciones.map((i) => (
              <li key={i.id} className="py-2 flex justify-between gap-2">
                <span>{i.nombre} · {i.email} · <span className="text-gray-500">{i.rol}</span></span>
                <span className="flex gap-3">
                  <button className="text-xs text-brand" onClick={async () => { setError(null); try { await api(`/admin/invitaciones/${i.id}/reenviar`, { method: 'POST' }); alert(`Invitación reenviada a ${i.email}`); } catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); } }}>reenviar</button>
                  {i.usada_at ? <span className="text-xs text-green-700">usada</span> : <button className="text-xs text-red-600" onClick={async () => { await api(`/admin/invitaciones/${i.id}`, { method: 'DELETE' }); void cargar(); }}>eliminar</button>}
                </span>
              </li>
            ))}
            {invitaciones.length === 0 && <li className="text-gray-400 py-2">Sin invitaciones.</li>}
          </ul>
        </div>
      </section>
    </div>
  );
}
