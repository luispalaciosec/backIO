'use client';
import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Senal } from '@backio/shared';
import { coincideBusqueda, diaLocal, hoyLocal, sumarDias } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { fecha } from '@/lib/format';

const SEV: Record<string, string> = {
  critica: 'bg-red-100 text-red-800',
  alta: 'bg-amber-100 text-amber-800',
  media: 'bg-gray-100 text-gray-700',
};
const ORDEN = { critica: 0, alta: 1, media: 2 } as const;

interface Grupo {
  clave: string;
  nombre: string;
  senales: Senal[];
  criticas: number;
  pendientes: number;
}

export const atenderSenal = (semanaId: string, s: Senal, atendida: boolean) =>
  api(`/semanas/${semanaId}/senales/atender`, {
    method: 'POST',
    json: {
      atendida,
      senal: {
        tipo: s.tipo,
        severidad: s.severidad,
        entidad_tipo: s.entidad_tipo,
        entidad_id: s.entidad_id,
        titulo: s.titulo,
        detalle: s.detalle,
      },
    },
  });

/** De quién es la señal: la persona del compromiso, de la tarea o la señal misma. */
function personaDeSenal(s: Senal, owners: Record<string, string[]>): string | null {
  const d = s.detalle as { responsable_id?: string; owner?: string | null };
  if (d.responsable_id) return d.responsable_id;
  if (d.owner) return d.owner;
  if (s.entidad_tipo === 'requerimiento') return owners[s.entidad_id]?.[0] ?? null;
  return s.entidad_tipo === 'usuario' ? s.entidad_id : null;
}

/** Convierte una señal en un acuerdo: precargado con su texto y su persona. Al guardar, la señal queda atendida. */
export function FormAcuerdo({
  texto,
  responsable,
  usuarios,
  guardar,
  cancelar,
}: {
  texto: string;
  responsable: string | null;
  usuarios: { id: string; nombre: string }[];
  guardar: (x: { descripcion: string; responsable_id: string; fecha_compromiso: string }) => Promise<void>;
  cancelar: () => void;
}) {
  const [f, setF] = useState({ descripcion: texto, responsable_id: responsable ?? '', fecha_compromiso: '' });
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-2 rounded-md bg-gray-50 p-3 flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await guardar(f);
        setBusy(false);
      }}
    >
      <input
        className="input flex-1 min-w-52 text-xs py-1"
        aria-label="Acuerdo"
        placeholder="¿Qué se acordó?"
        required
        minLength={3}
        value={f.descripcion}
        onChange={(e) => setF({ ...f, descripcion: e.target.value })}
      />
      <select
        className="input w-44 text-xs py-1"
        aria-label="Responsable"
        required
        value={f.responsable_id}
        onChange={(e) => setF({ ...f, responsable_id: e.target.value })}
      >
        <option value="">Responsable…</option>
        {usuarios.map((u) => (
          <option key={u.id} value={u.id}>
            {u.nombre}
          </option>
        ))}
      </select>
      <input
        className="input w-36 text-xs py-1"
        type="date"
        aria-label="Fecha del compromiso"
        required
        min={sumarDias(hoyLocal(), 1)}
        value={f.fecha_compromiso}
        onChange={(e) => setF({ ...f, fecha_compromiso: e.target.value })}
      />
      <button className="btn-primary text-xs py-1" disabled={busy}>
        {busy ? 'Guardando…' : 'Guardar acuerdo'}
      </button>
      <button type="button" className="btn-ghost text-xs py-1" onClick={cancelar}>
        Cerrar
      </button>
    </form>
  );
}

/**
 * Señales del weekly por cliente (lo que no es de un cliente va en «Equipo») o por persona, con buscador. Cada una se marca
 * «Atendida» o se vuelve acuerdo. Una señal atendida no vuelve como nueva la semana siguiente mientras no empeore (migración 35).
 */
export function SenalesWeekly({
  senales,
  titulo = 'Señales',
  semanaId,
  mesaId,
  clienteDeTarea,
  ownersDeTarea,
  clientes,
  ejecutivas = {},
  mesaDeCliente = {},
  soloCuentasDe = null,
  nombre,
  usuarios,
  yo,
  escribe,
}: {
  senales: Senal[];
  titulo?: string;
  semanaId: string;
  mesaId: string | null;
  clienteDeTarea: Record<string, string>;
  ownersDeTarea: Record<string, string[]>;
  clientes: Record<string, string>;
  /** cliente → ejecutiva de cuenta (migración 37): entra al bloque de su cuenta aunque no sea de la mesa. */
  ejecutivas?: Record<string, string>;
  /** cliente → mesa: un acuerdo creado desde «Mis cuentas» queda en la mesa de ese cliente. */
  mesaDeCliente?: Record<string, string>;
  /** Vista «Mis cuentas»: fija el filtro a las cuentas de esa persona. */
  soloCuentasDe?: string | null;
  nombre: Record<string, string>;
  usuarios: { id: string; nombre: string }[];
  yo: string | null;
  escribe: boolean;
}) {
  const router = useRouter();
  const [ocultarAtendidas, setOcultar] = useState(true);
  const [abierto, setAbierto] = useState<Record<string, boolean>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cuentasDe, setCuentasDe] = useState(soloCuentasDe ?? '');
  const [q, setQ] = useState('');
  const [por, setPor] = useState<'cliente' | 'persona'>('cliente');
  const [acordando, setAcordando] = useState<string | null>(null);

  const clienteDeSenal = useCallback(
    (s: Senal) => {
      const cliente =
        s.entidad_tipo === 'cliente'
          ? s.entidad_id
          : s.entidad_tipo === 'requerimiento'
            ? (clienteDeTarea[s.entidad_id] ?? (s.detalle.cliente_id as string | undefined))
            : undefined;
      return cliente && clientes[cliente] ? cliente : null;
    },
    [clienteDeTarea, clientes],
  );
  const grupos = useMemo(() => {
    const m = new Map<string, Grupo>();
    for (const s of senales) {
      const cliente = clienteDeSenal(s);
      const persona = personaDeSenal(s, ownersDeTarea);
      if (
        !coincideBusqueda(
          q,
          `${s.titulo} ${s.tipo.replace(/_/g, ' ')} ${cliente ? clientes[cliente] : ''} ${persona ? (nombre[persona] ?? '') : ''}`,
        )
      )
        continue;
      const clave = por === 'cliente' ? (cliente ?? 'equipo') : (persona ?? 'sin_persona');
      const g = m.get(clave) ?? {
        clave,
        nombre:
          por === 'cliente'
            ? clave === 'equipo'
              ? 'Equipo'
              : clientes[clave]!
            : clave === 'sin_persona'
              ? 'Sin responsable'
              : (nombre[clave] ?? '—'),
        senales: [],
        criticas: 0,
        pendientes: 0,
      };
      g.senales.push(s);
      if (!s.atendida) {
        g.pendientes += 1;
        if (s.severidad === 'critica') g.criticas += 1;
      }
      m.set(clave, g);
    }
    for (const g of m.values())
      g.senales.sort((a, b) => Number(a.atendida) - Number(b.atendida) || ORDEN[a.severidad] - ORDEN[b.severidad]);
    return [...m.values()].sort((a, b) => b.criticas - a.criticas || b.pendientes - a.pendientes || a.nombre.localeCompare(b.nombre));
  }, [senales, clienteDeSenal, ownersDeTarea, clientes, nombre, q, por]);

  const pendientes = senales.filter((s) => !s.atendida).length;
  const deEjecutiva = (s: Senal) => {
    const c = clienteDeSenal(s);
    return c ? ejecutivas[c] : undefined;
  };
  const conEjecutiva = [...new Set(senales.map(deEjecutiva))].filter((id): id is string => !!id);
  const visibles = grupos
    .map((g) => {
      if (!cuentasDe) return g;
      const propias = g.senales.filter((s) => deEjecutiva(s) === cuentasDe);
      const abiertas = propias.filter((s) => !s.atendida);
      return { ...g, senales: propias, pendientes: abiertas.length, criticas: abiertas.filter((s) => s.severidad === 'critica').length };
    })
    .filter((g) => g.senales.length > 0 && (!ocultarAtendidas || g.pendientes > 0));

  async function marcar(s: Senal, atendida: boolean) {
    const clave = `${s.tipo}|${s.entidad_id}`;
    setOcupado(clave);
    setError(null);
    try {
      await atenderSenal(semanaId, s, atendida);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setOcupado(null);
    }
  }
  async function crearAcuerdo(s: Senal, f: { descripcion: string; responsable_id: string; fecha_compromiso: string }) {
    setError(null);
    try {
      await api(`/semanas/${semanaId}/acuerdos`, {
        method: 'POST',
        json: {
          ...f,
          mesa_id: mesaId ?? (clienteDeSenal(s) ? (mesaDeCliente[clienteDeSenal(s)!] ?? null) : null),
          requerimiento_id: s.entidad_tipo === 'requerimiento' ? s.entidad_id : null,
        },
      });
      setAcordando(null);
      await marcar(s, true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar el acuerdo');
    }
  }

  return (
    <section className="card">
      <div className="px-4 py-3 border-b border-gray-200 flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">
          {titulo} · {pendientes} por atender{senales.length > pendientes ? ` de ${senales.length}` : ''}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input w-52 text-xs py-1"
            placeholder="Buscar señal, cliente o persona"
            aria-label="Buscar en las señales"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="inline-flex rounded-md border border-gray-300 overflow-hidden text-xs" role="group" aria-label="Agrupar señales">
            {(['cliente', 'persona'] as const).map((x) => (
              <button
                key={x}
                type="button"
                aria-pressed={por === x}
                className={`px-2.5 py-1 ${por === x ? 'bg-brand text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                onClick={() => {
                  setPor(x);
                  setAbierto({});
                }}
              >
                Por {x}
              </button>
            ))}
          </div>
          {conEjecutiva.length > 0 && !soloCuentasDe && (
            <select
              className="input w-44 text-xs"
              value={cuentasDe}
              onChange={(e) => setCuentasDe(e.target.value)}
              title="Recorrer la agenda por cuentas"
            >
              <option value="">Todas las cuentas</option>
              {conEjecutiva.map((id) => (
                <option key={id} value={id}>
                  {id === yo ? 'Mis cuentas' : `Cuentas de ${nombre[id] ?? '—'}`}
                </option>
              ))}
            </select>
          )}
          <label className="text-xs text-gray-500 flex items-center gap-1.5">
            <input type="checkbox" checked={ocultarAtendidas} onChange={(e) => setOcultar(e.target.checked)} />
            Ocultar atendidas
          </label>
        </div>
      </div>
      {error && <p className="px-4 pt-3 text-xs text-red-600">{error}</p>}
      <ul className="divide-y divide-gray-100">
        {senales.length === 0 && <li className="p-4 text-sm text-gray-400">Sin señales. Recalcula para generar la agenda.</li>}
        {senales.length > 0 && visibles.length === 0 && (
          <li className="p-4 text-sm text-gray-400">
            {q || cuentasDe ? 'Nada coincide con el filtro.' : 'Todas las señales están atendidas.'}
          </li>
        )}
        {visibles.map((g) => {
          const lista = g.senales.filter((s) => !ocultarAtendidas || !s.atendida);
          // Abiertos por defecto los grupos con críticas pendientes.
          const ver = abierto[g.clave] ?? g.criticas > 0;
          return (
            <li key={g.clave}>
              <button
                type="button"
                className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-gray-50"
                onClick={() => setAbierto({ ...abierto, [g.clave]: !ver })}
                aria-expanded={ver}
              >
                <span className="font-medium text-sm">
                  {ver ? '▾' : '▸'} {g.nombre}
                  {por === 'cliente' && ejecutivas[g.clave] && (
                    <span className="font-normal text-gray-500"> · {nombre[ejecutivas[g.clave]!] ?? '—'}</span>
                  )}
                </span>
                <span className="flex items-center gap-2 text-xs">
                  {g.criticas > 0 && <span className={`rounded px-2 py-0.5 font-semibold ${SEV.critica}`}>{g.criticas} críticas</span>}
                  <span className="text-gray-500">
                    {g.pendientes} por atender{g.senales.length > g.pendientes ? ` · ${g.senales.length - g.pendientes} atendidas` : ''}
                  </span>
                </span>
              </button>
              {ver && (
                <ul className="pb-2">
                  {lista.map((s) => {
                    const clave = `${s.tipo}|${s.entidad_id}`;
                    return (
                      <li key={clave} className={`px-4 py-2 pl-8 text-sm ${s.atendida ? 'opacity-60' : ''}`}>
                        <div className="flex items-start gap-3">
                          <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${SEV[s.severidad]}`}>{s.severidad}</span>
                          <div className="flex-1 min-w-0">
                            <div className="break-words">{s.titulo}</div>
                            <div className="text-xs text-gray-500">
                              {s.tipo.replace(/_/g, ' ')}
                              {s.atendida && s.atendida_at
                                ? ` · atendida${s.atendida_por ? ` por ${nombre[s.atendida_por] ?? '—'}` : ''} el ${fecha(diaLocal(s.atendida_at))}`
                                : ''}
                            </div>
                          </div>
                          {escribe && !s.atendida && (
                            <button
                              type="button"
                              className="btn-secondary text-xs py-1 shrink-0"
                              onClick={() => setAcordando(acordando === clave ? null : clave)}
                            >
                              Crear acuerdo
                            </button>
                          )}
                          {escribe && (
                            <button
                              type="button"
                              className={s.atendida ? 'btn-ghost text-xs shrink-0' : 'btn-primary text-xs py-1 shrink-0'}
                              disabled={ocupado === clave}
                              onClick={() => marcar(s, !s.atendida)}
                            >
                              {ocupado === clave ? 'Guardando…' : s.atendida ? 'Reabrir' : 'Atendida'}
                            </button>
                          )}
                        </div>
                        {acordando === clave && (
                          <FormAcuerdo
                            texto={s.titulo}
                            responsable={personaDeSenal(s, ownersDeTarea)}
                            usuarios={usuarios}
                            guardar={(f) => crearAcuerdo(s, f)}
                            cancelar={() => setAcordando(null)}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
