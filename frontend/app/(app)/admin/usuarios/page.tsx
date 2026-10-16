'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Usuario, Rol, Area } from '@backio/shared';
import { AREAS, AREA_LABEL } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';

const ROLES: Rol[] = ['admin', 'gerencia', 'operaciones', 'ejecutiva', 'lider', 'colaborador'];
const ROL_LABEL: Record<Rol, string> = {
  admin: 'Admin',
  gerencia: 'Gerencia',
  operaciones: 'Operaciones',
  ejecutiva: 'Ejecutiva',
  lider: 'Líder',
  colaborador: 'Colaborador',
};

type Persona = Usuario & { basecamp_conectado_at: string | null };
interface Invitacion {
  id: string;
  email: string;
  nombre: string;
  rol: Rol;
  capacidad_semanal: number;
  usada_at: string | null;
}
interface Vinculo {
  personas_basecamp: number;
  vinculados: { usuario: string; basecamp_user_id: number }[];
  sin_coincidencia: string[];
  solo_en_basecamp: string[];
}

/** Estado de Basecamp de una persona: conectó su cuenta, está enlazada pero no conectó, o ni siquiera enlazada. */
type EstadoBasecamp = 'conectado' | 'sin_conectar' | 'sin_vincular';
const estadoBasecamp = (u: Persona): EstadoBasecamp =>
  u.basecamp_conectado_at ? 'conectado' : u.basecamp_user_id ? 'sin_conectar' : 'sin_vincular';
const ESTADO_BC: Record<EstadoBasecamp, { label: string; cls: string; ayuda: string }> = {
  conectado: {
    label: 'Conectado',
    cls: 'bg-green-100 text-green-800',
    ayuda: 'Lo que hace en BackIO sale a su nombre en Basecamp',
  },
  sin_conectar: {
    label: 'Sin conectar',
    cls: 'bg-amber-100 text-amber-900',
    ayuda: 'Enlazado a Basecamp, pero no conectó su cuenta: BackIO no escribe en Basecamp por esta persona',
  },
  sin_vincular: {
    label: 'Sin vincular',
    cls: 'bg-gray-100 text-gray-600',
    ayuda: 'No tiene usuario de Basecamp enlazado: usa «Vincular con Basecamp» o escribe su id al editar',
  },
};

const iniciales = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
const fechaCorta = (iso: string) => new Date(iso).toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' });

function Resumen({
  titulo,
  valor,
  detalle,
  activo,
  onClick,
}: {
  titulo: string;
  valor: string;
  detalle?: string;
  activo: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`card p-3 text-left transition hover:border-brand ${activo ? 'ring-2 ring-brand/40 border-brand' : ''}`}
      aria-pressed={activo}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{titulo}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{valor}</div>
      {detalle && <div className="text-xs text-gray-500">{detalle}</div>}
    </button>
  );
}

/** Panel lateral para editar a una persona: rol, área, capacidad y enlace con Basecamp. */
function EditarPersona({ persona, onCerrar, onGuardado }: { persona: Persona; onCerrar: () => void; onGuardado: (msg: string) => void }) {
  const [f, setF] = useState({
    nombre: persona.nombre,
    rol: persona.rol,
    area: (persona.area ?? '') as Area | '',
    capacidad_semanal: persona.capacidad_semanal,
    basecamp_user_id: persona.basecamp_user_id ? String(persona.basecamp_user_id) : '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bc = ESTADO_BC[estadoBasecamp(persona)];

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const id = f.basecamp_user_id.trim() ? Number(f.basecamp_user_id.trim()) : null;
    if (id !== null && !Number.isInteger(id)) {
      setError('El id de Basecamp es un número');
      setBusy(false);
      return;
    }
    const cambios: Record<string, unknown> = {};
    if (f.nombre.trim() !== persona.nombre) cambios.nombre = f.nombre.trim();
    if (f.rol !== persona.rol) cambios.rol = f.rol;
    if ((f.area || null) !== (persona.area ?? null)) cambios.area = f.area || null;
    if (f.capacidad_semanal !== persona.capacidad_semanal) cambios.capacidad_semanal = f.capacidad_semanal;
    if (id !== persona.basecamp_user_id) cambios.basecamp_user_id = id;
    if (!Object.keys(cambios).length) return onCerrar();
    try {
      await api(`/admin/usuarios/${persona.id}`, { method: 'PATCH', json: cambios });
      onGuardado(`Cambios guardados para ${f.nombre.trim()}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onCerrar}>
      <form
        onSubmit={guardar}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-md flex-col bg-white shadow-xl"
        aria-label={`Editar a ${persona.nombre}`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-gray-200 p-5">
          <div>
            <div className="text-lg font-semibold">{persona.nombre}</div>
            <div className="text-sm text-gray-500">{persona.email}</div>
          </div>
          <button type="button" className="btn-ghost px-2" onClick={onCerrar} aria-label="Cerrar">
            ✕
          </button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {error && <Alert tipo="error">{error}</Alert>}
          <div>
            <label className="label" htmlFor="ed-nombre">
              Nombre
            </label>
            <input
              id="ed-nombre"
              className="input"
              required
              minLength={2}
              value={f.nombre}
              onChange={(e) => setF({ ...f, nombre: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="ed-rol">
                Rol
              </label>
              <select id="ed-rol" className="input" value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value as Rol })}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROL_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="ed-area">
                Área (KPIs)
              </label>
              <select id="ed-area" className="input" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value as Area | '' })}>
                <option value="">Sin área</option>
                {AREAS.map((a) => (
                  <option key={a} value={a}>
                    {AREA_LABEL[a]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="ed-cap">
              Capacidad (horas por semana)
            </label>
            <input
              id="ed-cap"
              className="input w-28"
              type="number"
              min={1}
              max={80}
              value={f.capacidad_semanal}
              onChange={(e) => setF({ ...f, capacidad_semanal: Number(e.target.value) })}
            />
          </div>
          <fieldset className="space-y-2 rounded-md border border-gray-200 p-3">
            <legend className="px-1 text-sm font-medium">Basecamp</legend>
            <div className="flex items-center gap-2 text-sm">
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${bc.cls}`}>{bc.label}</span>
              {persona.basecamp_conectado_at && <span className="text-gray-500">desde el {fechaCorta(persona.basecamp_conectado_at)}</span>}
            </div>
            <p className="text-xs text-gray-500">{bc.ayuda}.</p>
            <label className="label" htmlFor="ed-bc">
              Id de la persona en Basecamp
            </label>
            <input
              id="ed-bc"
              className="input w-40"
              inputMode="numeric"
              placeholder="opcional"
              value={f.basecamp_user_id}
              onChange={(e) => setF({ ...f, basecamp_user_id: e.target.value })}
            />
            <p className="text-xs text-gray-500">
              Se llena solo con «Vincular con Basecamp» cuando el correo es el mismo. Conectar la cuenta lo hace cada persona desde Mi
              Basecamp.
            </p>
          </fieldset>
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-gray-200 p-5">
          {persona.activo ? (
            <Link href={`/admin/usuarios/${persona.id}/salida`} className="link-danger text-sm">
              Registrar salida…
            </Link>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={onCerrar}>
              Cancelar
            </button>
            <button className="btn-primary" disabled={busy}>
              {busy ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}

/** Ventana para invitar: la cuenta se crea y le llega el correo para definir contraseña. */
function Invitar({ onCerrar, onInvitado }: { onCerrar: () => void; onInvitado: (msg: string, error?: string) => void }) {
  const [inv, setInv] = useState({ email: '', nombre: '', rol: 'colaborador' as Rol, capacidad_semanal: 40 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function enviar(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ envio?: { enviado: boolean; error?: string; url?: string } }>('/admin/invitaciones', {
        method: 'POST',
        json: inv,
      });
      if (r.envio && !r.envio.enviado)
        onInvitado(
          `Invitación guardada para ${inv.nombre}.`,
          `El correo no salió: ${r.envio.error ?? 'error'}${r.envio.url ? `. Enlace para enviarle a mano: ${r.envio.url}` : ''}`,
        );
      else onInvitado(`Invitación enviada a ${inv.email}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo invitar');
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onCerrar}>
      <form
        onSubmit={enviar}
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-md space-y-4 p-5"
        aria-label="Invitar a una persona"
      >
        <div>
          <div className="text-lg font-semibold">Invitar a una persona</div>
          <p className="text-sm text-gray-500">
            Le llega un correo para definir su contraseña (vence en 24 h). Si no llega, la reenvías desde la lista.
          </p>
        </div>
        {error && <Alert tipo="error">{error}</Alert>}
        <div>
          <label className="label" htmlFor="inv-nombre">
            Nombre
          </label>
          <input
            id="inv-nombre"
            className="input"
            required
            value={inv.nombre}
            onChange={(e) => setInv({ ...inv, nombre: e.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="inv-email">
            Correo
          </label>
          <input
            id="inv-email"
            className="input"
            type="email"
            placeholder="persona@geeks.com.ec"
            required
            value={inv.email}
            onChange={(e) => setInv({ ...inv, email: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="inv-rol">
              Rol
            </label>
            <select id="inv-rol" className="input" value={inv.rol} onChange={(e) => setInv({ ...inv, rol: e.target.value as Rol })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROL_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="inv-cap">
              Horas por semana
            </label>
            <input
              id="inv-cap"
              className="input"
              type="number"
              min={1}
              max={80}
              value={inv.capacidad_semanal}
              onChange={(e) => setInv({ ...inv, capacidad_semanal: Number(e.target.value) })}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onCerrar}>
            Cancelar
          </button>
          <button className="btn-primary" disabled={busy}>
            {busy ? 'Enviando…' : 'Enviar invitación'}
          </button>
        </div>
      </form>
    </div>
  );
}

type FiltroBc = '' | EstadoBasecamp;

export default function AdminUsuariosPage() {
  const [usuarios, setUsuarios] = useState<Persona[] | null>(null);
  const [invitaciones, setInvitaciones] = useState<Invitacion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [vinculando, setVinculando] = useState(false);
  const [vinculo, setVinculo] = useState<Vinculo | null>(null);
  const [editando, setEditando] = useState<Persona | null>(null);
  const [invitando, setInvitando] = useState(false);
  const [busyAcceso, setBusyAcceso] = useState(false);
  const [q, setQ] = useState('');
  const [rol, setRol] = useState<Rol | ''>('');
  const [bc, setBc] = useState<FiltroBc>('');
  const [verSinAcceso, setVerSinAcceso] = useState(false);

  const cargar = async () => {
    try {
      const [u, i] = await Promise.all([api<{ items: Persona[] }>('/admin/usuarios'), api<{ items: Invitacion[] }>('/admin/invitaciones')]);
      setUsuarios(u.items);
      setInvitaciones(i.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo cargar la lista');
    }
  };
  useEffect(() => {
    void cargar();
  }, []);

  const activos = useMemo(() => (usuarios ?? []).filter((u) => u.activo), [usuarios]);
  const cuenta = (e: EstadoBasecamp) => activos.filter((u) => estadoBasecamp(u) === e).length;
  const pendientes = invitaciones.filter((i) => !i.usada_at);
  const sinAcceso = (usuarios ?? []).filter((u) => !u.activo).length;

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (usuarios ?? [])
      .filter((u) => (verSinAcceso ? !u.activo : u.activo))
      .filter((u) => !rol || u.rol === rol)
      .filter((u) => !bc || estadoBasecamp(u) === bc)
      .filter((u) => !t || u.nombre.toLowerCase().includes(t) || u.email.toLowerCase().includes(t))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [usuarios, q, rol, bc, verSinAcceso]);

  const filtrarBc = (e: FiltroBc) => {
    setVerSinAcceso(false);
    setBc((actual) => (actual === e ? '' : e));
  };

  async function vincular() {
    setVinculando(true);
    setError(null);
    setVinculo(null);
    try {
      setVinculo(await api<Vinculo>('/admin/usuarios/basecamp/vincular', { method: 'POST' }));
      await cargar();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo leer Basecamp');
    }
    setVinculando(false);
  }

  async function restaurar(u: Persona) {
    if (
      !confirm(
        `Restaurar el acceso de ${u.nombre}. Se reactiva la cuenta y recibe un correo para definir contraseña nueva. Las tareas que se reasignaron no vuelven solas. ¿Continuar?`,
      )
    )
      return;
    setBusyAcceso(true);
    setError(null);
    try {
      await api(`/admin/usuarios/${u.id}/restaurar-acceso`, { method: 'POST' });
      setOk(`Acceso restaurado para ${u.nombre}; le llegará el correo para definir su contraseña.`);
      await cargar();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo restaurar');
    }
    setBusyAcceso(false);
  }

  return (
    <div className="max-w-6xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Usuarios</h1>
          <p className="text-sm text-gray-500">
            Quién tiene acceso a BackIO, con qué rol, y si ya conectó su Basecamp. Cuando alguien se va, «Registrar salida» reparte lo que
            tenía abierto y cierra su acceso.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn-secondary"
            disabled={vinculando}
            title="Lee las personas de Basecamp y enlaza a cada usuario con el mismo correo"
            onClick={vincular}
          >
            {vinculando ? 'Leyendo Basecamp…' : '⇄ Vincular con Basecamp'}
          </button>
          <button className="btn-primary" onClick={() => setInvitando(true)}>
            + Invitar persona
          </button>
        </div>
      </header>

      {error && <Alert tipo="error">{error}</Alert>}
      {ok && <Alert tipo="ok">{ok}</Alert>}
      {vinculo && (
        <Alert tipo={vinculo.sin_coincidencia.length ? 'warn' : 'ok'}>
          <div>
            {vinculo.personas_basecamp} personas en Basecamp · {vinculo.vinculados.length} enlazadas ahora
            {vinculo.vinculados.length ? `: ${vinculo.vinculados.map((v) => v.usuario).join(', ')}` : ''}.
          </div>
          {vinculo.sin_coincidencia.length > 0 && (
            <div className="mt-1">
              Sin el mismo correo en Basecamp ({vinculo.sin_coincidencia.length}): {vinculo.sin_coincidencia.join(', ')}. Escribe su id al
              editarlas.
            </div>
          )}
          {vinculo.solo_en_basecamp.length > 0 && (
            <div className="mt-1 text-xs opacity-80">En Basecamp pero no en BackIO: {vinculo.solo_en_basecamp.join(', ')}.</div>
          )}
        </Alert>
      )}

      {usuarios && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Resumen
            titulo="Con acceso"
            valor={String(activos.length)}
            detalle={sinAcceso ? `${sinAcceso} sin acceso` : undefined}
            activo={!bc && !verSinAcceso}
            onClick={() => {
              setBc('');
              setVerSinAcceso(false);
            }}
          />
          <Resumen
            titulo="Basecamp conectado"
            valor={`${cuenta('conectado')} de ${activos.length}`}
            detalle="Sale a su nombre en Basecamp"
            activo={bc === 'conectado'}
            onClick={() => filtrarBc('conectado')}
          />
          <Resumen
            titulo="Falta conectar"
            valor={String(cuenta('sin_conectar') + cuenta('sin_vincular'))}
            detalle={cuenta('sin_vincular') ? `${cuenta('sin_vincular')} sin vincular` : 'Todos vinculados'}
            activo={bc === 'sin_conectar'}
            onClick={() => filtrarBc('sin_conectar')}
          />
          <Resumen
            titulo="Invitaciones"
            valor={String(pendientes.length)}
            detalle="Pendientes de aceptar"
            activo={false}
            onClick={() => document.getElementById('invitaciones')?.scrollIntoView({ behavior: 'smooth' })}
          />
        </section>
      )}

      <section className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 p-3">
          <input
            className="input max-w-xs"
            type="search"
            placeholder="Buscar por nombre o correo"
            aria-label="Buscar persona"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className="input w-auto" aria-label="Filtrar por rol" value={rol} onChange={(e) => setRol(e.target.value as Rol | '')}>
            <option value="">Todos los roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROL_LABEL[r]}
              </option>
            ))}
          </select>
          <select className="input w-auto" aria-label="Filtrar por Basecamp" value={bc} onChange={(e) => setBc(e.target.value as FiltroBc)}>
            <option value="">Basecamp: todos</option>
            <option value="conectado">Conectado</option>
            <option value="sin_conectar">Sin conectar</option>
            <option value="sin_vincular">Sin vincular</option>
          </select>
          <label className="ml-auto flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={verSinAcceso} onChange={(e) => setVerSinAcceso(e.target.checked)} />
            Ver quienes ya no tienen acceso
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr>
                <th className="th">Persona</th>
                <th className="th">Rol</th>
                <th className="th">Área</th>
                <th className="th text-right">Horas/sem</th>
                <th className="th">Basecamp</th>
                <th className="th" aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {!usuarios && (
                <tr>
                  <td className="td text-gray-400" colSpan={6}>
                    Cargando…
                  </td>
                </tr>
              )}
              {usuarios && visibles.length === 0 && (
                <tr>
                  <td className="td text-gray-400" colSpan={6}>
                    Nadie coincide con los filtros.
                  </td>
                </tr>
              )}
              {visibles.map((u) => {
                const e = ESTADO_BC[estadoBasecamp(u)];
                return (
                  <tr key={u.id} className={`hover:bg-gray-50 ${u.activo ? '' : 'opacity-70'}`}>
                    <td className="td">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand">
                          {iniciales(u.nombre)}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate font-medium">{u.nombre}</div>
                          <div className="truncate text-xs text-gray-500">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="td">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">{ROL_LABEL[u.rol]}</span>
                    </td>
                    <td className="td text-sm text-gray-700">{u.area ? AREA_LABEL[u.area] : <span className="text-gray-400">—</span>}</td>
                    <td className="td text-right text-sm tabular-nums">{u.capacidad_semanal}</td>
                    <td className="td">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${e.cls}`}
                        title={u.basecamp_conectado_at ? `${e.ayuda}. Desde el ${fechaCorta(u.basecamp_conectado_at)}` : e.ayuda}
                      >
                        {e.label}
                      </span>
                    </td>
                    <td className="td whitespace-nowrap text-right">
                      {u.activo ? (
                        <button className="btn-ghost text-sm" onClick={() => setEditando(u)}>
                          Editar
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">Sin acceso</span>
                          <button className="link-action text-sm" disabled={busyAcceso} onClick={() => restaurar(u)}>
                            Restaurar
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section id="invitaciones" className="card p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="font-semibold">Invitaciones</div>
          <span className="text-xs text-gray-500">Un correo @geeks sin invitación entra como colaborador.</span>
        </div>
        <ul className="divide-y divide-gray-100 text-sm">
          {invitaciones.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium">{i.nombre}</span> <span className="text-gray-500">· {i.email}</span>{' '}
                <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{ROL_LABEL[i.rol]}</span>
              </span>
              <span className="flex items-center gap-3">
                {i.usada_at ? (
                  <span className="text-xs font-medium text-green-700">Aceptada</span>
                ) : (
                  <>
                    <button
                      className="link-action"
                      onClick={async () => {
                        setError(null);
                        try {
                          await api(`/admin/invitaciones/${i.id}/reenviar`, { method: 'POST' });
                          setOk(`Invitación reenviada a ${i.email}.`);
                        } catch (e) {
                          setError(e instanceof ApiError ? e.message : 'No se pudo reenviar');
                        }
                      }}
                    >
                      Reenviar
                    </button>
                    <button
                      className="link-danger"
                      onClick={async () => {
                        if (!confirm(`¿Eliminar la invitación de ${i.nombre}?`)) return;
                        await api(`/admin/invitaciones/${i.id}`, { method: 'DELETE' });
                        void cargar();
                      }}
                    >
                      Eliminar
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
          {invitaciones.length === 0 && <li className="py-2 text-gray-400">Sin invitaciones.</li>}
        </ul>
      </section>

      {editando && (
        <EditarPersona
          persona={editando}
          onCerrar={() => setEditando(null)}
          onGuardado={(msg) => {
            setEditando(null);
            setOk(msg);
            void cargar();
          }}
        />
      )}
      {invitando && (
        <Invitar
          onCerrar={() => setInvitando(false)}
          onInvitado={(msg, err) => {
            setInvitando(false);
            setOk(msg);
            if (err) setError(err);
            void cargar();
          }}
        />
      )}
    </div>
  );
}
