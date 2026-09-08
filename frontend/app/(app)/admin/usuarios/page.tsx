'use client';
import { useEffect, useState, type FormEvent } from 'react';
import type { Usuario, Rol } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';

const ROLES: Rol[] = ['admin', 'gerencia', 'operaciones', 'ejecutiva', 'lider', 'colaborador'];
interface Invitacion { id: string; email: string; nombre: string; rol: Rol; capacidad_semanal: number; usada_at: string | null }

interface Vinculo { personas_basecamp: number; vinculados: { usuario: string; basecamp_user_id: number }[]; sin_coincidencia: string[]; solo_en_basecamp: string[] }

export default function AdminUsuariosPage() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [invitaciones, setInvitaciones] = useState<Invitacion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [vinculando, setVinculando] = useState(false);
  const [vinculo, setVinculo] = useState<Vinculo | null>(null);
  const [quitar, setQuitar] = useState<Usuario | null>(null);
  const [reasignarA, setReasignarA] = useState('');
  const [busyAcceso, setBusyAcceso] = useState(false);
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
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Usuarios</h1>
          <p className="text-sm text-gray-500">Dar acceso: invita con correo y rol (abajo). Quitar acceso: botón en la fila; cierra sesión, bloquea el ingreso y reasigna sus tareas. Un correo @geeks sin invitación entra como colaborador.</p>
        </div>
        <button className="btn-secondary" disabled={vinculando} title="Lee las personas de la cuenta Basecamp y llena el Basecamp user id de cada usuario con el mismo correo" onClick={async () => {
          setVinculando(true); setError(null); setVinculo(null);
          try { setVinculo(await api<Vinculo>('/admin/usuarios/basecamp/vincular', { method: 'POST' })); await cargar(); }
          catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
          setVinculando(false);
        }}>{vinculando ? 'Escaneando…' : '⇄ Vincular con Basecamp'}</button>
      </header>
      {error && <Alert tipo="error">{error}</Alert>}
      {ok && <Alert tipo="ok">{ok}</Alert>}
      {quitar && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50" onClick={() => setQuitar(null)}>
          <div className="card w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div>
              <div className="font-semibold">Quitar acceso a {quitar.nombre}</div>
              <p className="text-sm text-gray-600 mt-1">Se cierra su sesión, se bloquea el ingreso, se revocan sus API keys y tokens, y queda inactivo en BackIO. Sus tareas abiertas se reasignan a quien elijas o quedan sin responsable. Su historial (tareas, horas, auditoría) se conserva.</p>
            </div>
            <div>
              <label className="label">Reasignar sus tareas abiertas a</label>
              <select className="input" value={reasignarA} onChange={(e) => setReasignarA(e.target.value)}>
                <option value="">Nadie (quedan sin responsable)</option>
                {usuarios.filter((x) => x.activo && x.id !== quitar.id).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setQuitar(null)}>Cancelar</button>
              <button className="btn-danger" disabled={busyAcceso} onClick={async () => {
                setBusyAcceso(true); setError(null);
                try { const r = await api<{ tareas_reasignadas: number; auth_bloqueado: boolean }>(`/admin/usuarios/${quitar.id}/quitar-acceso`, { method: 'POST', json: { reasignar_a: reasignarA || null } }); setOk(`${quitar.nombre} ya no tiene acceso. ${r.tareas_reasignadas} tareas ${reasignarA ? 'reasignadas' : 'sin responsable'}.${r.auth_bloqueado ? '' : ' Aviso: no se pudo bloquear en Auth; revisa en Supabase.'}`); setQuitar(null); await cargar(); }
                catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
                setBusyAcceso(false);
              }}>{busyAcceso ? 'Quitando…' : 'Quitar acceso'}</button>
            </div>
          </div>
        </div>
      )}
      {vinculo && (
        <Alert tipo={vinculo.sin_coincidencia.length ? 'warn' : 'ok'}>
          <div>{vinculo.personas_basecamp} personas en Basecamp · {vinculo.vinculados.length} usuarios vinculados ahora{vinculo.vinculados.length ? `: ${vinculo.vinculados.map((v) => v.usuario).join(', ')}` : ''}.</div>
          {vinculo.sin_coincidencia.length > 0 && <div className="mt-1">Sin correo igual en Basecamp ({vinculo.sin_coincidencia.length}): {vinculo.sin_coincidencia.join(', ')}. Escribe su id a mano.</div>}
          {vinculo.solo_en_basecamp.length > 0 && <div className="mt-1 text-xs opacity-80">En Basecamp pero no en BackIO: {vinculo.solo_en_basecamp.join(', ')}.</div>}
        </Alert>
      )}

      <section className="card overflow-x-auto">
        <table className="w-full min-w-[820px]">
          <thead><tr><th className="th">Nombre</th><th className="th">Email</th><th className="th">Rol</th><th className="th">Capacidad h/sem</th><th className="th">Basecamp user id</th><th className="th">Acceso</th></tr></thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id}>
                <td className="td font-medium">{u.nombre}</td>
                <td className="td text-gray-600">{u.email}</td>
                <td className="td"><select className="input" defaultValue={u.rol} onChange={(e) => patch(u.id, { rol: e.target.value })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></td>
                <td className="td"><input className="input w-20" type="number" min={1} max={80} defaultValue={u.capacidad_semanal} onBlur={(e) => Number(e.target.value) !== u.capacidad_semanal && patch(u.id, { capacidad_semanal: Number(e.target.value) })} /></td>
                <td className="td"><input className="input w-36" inputMode="numeric" defaultValue={u.basecamp_user_id ?? ''} placeholder="opcional" onBlur={(e) => { const v = e.target.value.trim(); const n = v ? Number(v) : null; if (n !== u.basecamp_user_id) void patch(u.id, { basecamp_user_id: n }); }} /></td>
                <td className="td whitespace-nowrap">
                  {u.activo
                    ? <span className="inline-flex items-center gap-2"><span className="rounded-full bg-green-100 text-green-800 px-2 py-0.5 text-xs font-semibold">activo</span><button type="button" className="link-danger text-xs" onClick={() => { setQuitar(u); setReasignarA(''); }}>Quitar acceso</button></span>
                    : <span className="inline-flex items-center gap-2"><span className="rounded-full bg-gray-100 text-gray-600 px-2 py-0.5 text-xs font-semibold">sin acceso</span><button type="button" className="link-action text-xs" disabled={busyAcceso} onClick={async () => { if (!confirm(`Restaurar el acceso de ${u.nombre}. Se reactiva la cuenta y recibe un correo para definir contraseña nueva. ¿Continuar?`)) return; setBusyAcceso(true); setError(null); try { await api(`/admin/usuarios/${u.id}/restaurar-acceso`, { method: 'POST' }); setOk(`Acceso restaurado para ${u.nombre}; le llegará el correo para definir su contraseña.`); await cargar(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); } setBusyAcceso(false); }}>Restaurar</button></span>}
                </td>
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
                  <button className="link-action" onClick={async () => { setError(null); try { await api(`/admin/invitaciones/${i.id}/reenviar`, { method: 'POST' }); alert(`Invitación reenviada a ${i.email}`); } catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); } }}>reenviar</button>
                  {i.usada_at ? <span className="text-xs text-green-700">usada</span> : <button className="link-danger" onClick={async () => { await api(`/admin/invitaciones/${i.id}`, { method: 'DELETE' }); void cargar(); }}>eliminar</button>}
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
