'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Cliente, RequerimientoMetricas, Usuario } from '@backio/shared';
import { coincideBusqueda, lunesDe, sumarDias } from '@backio/shared';
import { USUARIOS_CON_INACTIVOS, conNombrePersona } from '@/lib/personas';
import { api, ApiError } from '@/lib/api';
import { fecha } from '@/lib/format';
import { EstadoChip } from '@/components/ui/EstadoChip';

type R = RequerimientoMetricas;
type Agrupar = 'persona' | 'cliente' | 'proyecto' | 'fecha' | 'nada';
interface CargaDia {
  horas: Record<string, Record<string, number>>;
  capacidad_dia: Record<string, number>;
  otras_mesas: Record<string, number>;
}
interface Filtros {
  q: string;
  cliente: string;
  proyecto: string;
  persona: string;
  ejecutiva: string;
  chips: string[];
  agrupar: Agrupar;
}
const FILTROS0: Filtros = { q: '', cliente: '', proyecto: '', persona: '', ejecutiva: '', chips: [], agrupar: 'persona' };
const KEY = 'backio:daily:armar'; // preferencia de interfaz, no dato de negocio

const horasTxt = (n: number) => `${n.toLocaleString('es-EC', { maximumFractionDigits: 1 })} h`;

/** Filtros, quedan en la URL (`?armar=`) para compartirlos y se recuerdan en el navegador. */
function leerFiltros(): Filtros {
  try {
    const crudo = new URLSearchParams(window.location.search).get('armar') ?? localStorage.getItem(KEY);
    return crudo ? { ...FILTROS0, ...(JSON.parse(crudo) as Partial<Filtros>) } : FILTROS0;
  } catch {
    return FILTROS0;
  }
}
function guardarFiltros(f: Filtros) {
  try {
    const crudo = JSON.stringify(f);
    localStorage.setItem(KEY, crudo);
    const url = new URL(window.location.href);
    url.searchParams.set('armar', crudo);
    window.history.replaceState(window.history.state, '', url);
  } catch {
    /* sin storage */
  }
}

/**
 * Armar el día (docs/05): elegir qué se trabaja hoy en la mesa. Reemplaza a la lista plana: buscador por todo, filtros
 * combinables, agrupar por persona, cliente, proyecto o fecha, elegir por grupo y ver en vivo cuánto le toca a cada una.
 * La carga avisa, no bloquea.
 */
export function ArmarDia({
  hoy,
  mesa,
  mesaNombre,
  seleccionadasHoy,
  yo,
}: {
  hoy: string;
  mesa: string;
  mesaNombre: string;
  seleccionadasHoy: number;
  yo: string | null;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [items, setItems] = useState<R[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [proyectos, setProyectos] = useState<{ id: string; nombre: string; owner_ejecutiva?: string | null }[]>([]);
  const [personas, setPersonas] = useState<Usuario[]>([]);
  const [carga, setCarga] = useState<CargaDia | null>(null);
  const [f, setF] = useState<Filtros>(FILTROS0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  const cambiar = useCallback((p: Partial<Filtros>) => {
    setF((x) => {
      const n = { ...x, ...p };
      guardarFiltros(n);
      return n;
    });
  }, []);

  useEffect(() => {
    if (!abierto) return;
    setF(leerFiltros());
    Promise.all([
      api<{ items: R[] }>(`/requerimientos?activos=1${mesa ? `&mesa=${mesa}` : ''}`),
      api<{ items: Cliente[] }>('/clientes?todos=1'),
      api<{ items: { id: string; nombre: string; owner_ejecutiva?: string | null }[] }>('/proyectos').catch(() => ({ items: [] })),
      api<{ items: Usuario[] }>(USUARIOS_CON_INACTIVOS).catch(() => ({ items: [] as Usuario[] })),
      api<CargaDia>(`/semanas/daily/carga${mesa ? `?mesa=${mesa}` : ''}`).catch(() => null),
    ])
      .then(([r, c, p, u, k]) => {
        // Los clientes de prueba no entran a los rituales (migración 34).
        const prueba = new Set(c.items.filter((x) => x.es_prueba).map((x) => x.id));
        setItems(r.items.filter((x) => !prueba.has(x.cliente_id)));
        setClientes(c.items);
        setProyectos(p.items);
        setPersonas(conNombrePersona(u.items));
        setCarga(k);
      })
      .catch((e) => setMsg({ tipo: 'error', texto: e instanceof ApiError ? e.message : 'No se pudieron cargar las tareas' }));
  }, [abierto, mesa]);

  const nc = useCallback((id: string) => clientes.find((c) => c.id === id)?.nombre ?? '', [clientes]);
  const np = useCallback((id: string | null) => (id ? (proyectos.find((p) => p.id === id)?.nombre ?? '') : ''), [proyectos]);
  const npersona = useCallback((id: string) => personas.find((u) => u.id === id)?.nombre ?? '', [personas]);
  const ejecutivaDe = useCallback(
    (r: R) =>
      proyectos.find((p) => p.id === r.proyecto_id)?.owner_ejecutiva ?? clientes.find((c) => c.id === r.cliente_id)?.ejecutiva_id ?? null,
    [proyectos, clientes],
  );

  const manana = sumarDias(hoy, 1);
  const finSemana = sumarDias(lunesDe(hoy), 6);
  // Lo elegido el último día con selección antes de hoy y que sigue abierto.
  const ultimoDia = useMemo(
    () =>
      items.reduce<string | null>((m, r) => (r.daily_fecha && r.daily_fecha < hoy && (!m || r.daily_fecha > m) ? r.daily_fecha : m), null),
    [items, hoy],
  );
  const deAyer = useMemo(() => items.filter((r) => r.daily_fecha === ultimoDia), [items, ultimoDia]);

  /** Grupos de chips: dentro de un grupo suman (o), entre grupos restringen (y). */
  const GRUPOS_CHIPS: { id: string; chips: { id: string; label: string; test: (r: R) => boolean }[] }[] = [
    {
      id: 'urgencia',
      chips: [
        { id: 'atrasadas', label: 'Atrasadas', test: (r) => r.dias_atraso > 0 },
        { id: 'hoy', label: 'Vence hoy', test: (r) => r.fecha_entrega === hoy },
        { id: 'manana', label: 'Vence mañana', test: (r) => r.fecha_entrega === manana },
        { id: 'semana', label: 'Esta semana', test: (r) => !!r.fecha_entrega && r.fecha_entrega >= hoy && r.fecha_entrega <= finSemana },
      ],
    },
    {
      id: 'estado',
      chips: [
        { id: 'sin_iniciar', label: 'Sin iniciar', test: (r) => r.estado_operativo === 'priorizado' || r.estado_operativo === 'backlog' },
        { id: 'en_ejecucion', label: 'En ejecución', test: (r) => r.estado_operativo === 'en_ejecucion' },
        { id: 'en_revision', label: 'En revisión', test: (r) => r.estado_operativo === 'en_revision' },
      ],
    },
    {
      id: 'marcas',
      chips: [
        { id: 'elegidas', label: 'Elegidas hoy', test: (r) => r.daily_fecha === hoy },
        { id: 'de_ayer', label: 'Quedaron del último daily', test: (r) => r.daily_fecha === ultimoDia },
        { id: 'urgentes', label: 'Urgentes', test: (r) => r.planificacion === 'urgente' },
        { id: 'reprogramadas', label: 'Reprogramadas', test: (r) => r.veces_reprogramado > 0 },
        { id: 'mis_cuentas', label: 'Mis cuentas', test: (r) => !!yo && ejecutivaDe(r) === yo },
      ],
    },
  ];

  const texto = useCallback(
    (r: R) => `${r.titulo_interno} ${nc(r.cliente_id)} ${np(r.proyecto_id)} ${r.owner_agencia.map(npersona).join(' ')}`,
    [nc, np, npersona],
  );
  // Sin los chips: es la base de los conteos, para que digan cuántas hay antes de tocarlos.
  const base = items
    .filter((r) => !f.cliente || r.cliente_id === f.cliente)
    .filter((r) => !f.proyecto || r.proyecto_id === f.proyecto)
    .filter((r) => !f.persona || (f.persona === 'sin' ? r.owner_agencia.length === 0 : r.owner_agencia.includes(f.persona)))
    .filter((r) => !f.ejecutiva || ejecutivaDe(r) === f.ejecutiva)
    .filter((r) => coincideBusqueda(f.q, texto(r)));
  const visibles = base.filter((r) =>
    GRUPOS_CHIPS.every((g) => {
      const activos = g.chips.filter((c) => f.chips.includes(c.id));
      if (!activos.length) return true;
      // Las marcas restringen todas; urgencia y estado suman dentro de su grupo.
      return g.id === 'marcas' ? activos.every((c) => c.test(r)) : activos.some((c) => c.test(r));
    }),
  );

  const orden = (a: R, b: R) =>
    (b.daily_fecha === hoy ? 1 : 0) - (a.daily_fecha === hoy ? 1 : 0) ||
    (a.fecha_entrega ?? '9999').localeCompare(b.fecha_entrega ?? '9999');
  const grupos = useMemo(() => {
    if (f.agrupar === 'nada') return [{ clave: 'todas', nombre: 'Todas', tareas: [...visibles].sort(orden) }];
    const m = new Map<string, { clave: string; nombre: string; tareas: R[] }>();
    const poner = (clave: string, nombre: string, r: R) => {
      const g = m.get(clave) ?? { clave, nombre, tareas: [] };
      g.tareas.push(r);
      m.set(clave, g);
    };
    for (const r of visibles) {
      if (f.agrupar === 'persona') {
        if (!r.owner_agencia.length) poner('sin', '⚠ Sin responsable', r);
        // Una tarea con varios responsables aparece bajo cada uno, como en el mensaje del daily.
        for (const o of r.owner_agencia) poner(o, npersona(o) || 'Sin nombre', r);
      } else if (f.agrupar === 'cliente') poner(r.cliente_id, nc(r.cliente_id) || 'Sin cliente', r);
      else if (f.agrupar === 'proyecto') poner(r.proyecto_id ?? 'sin', np(r.proyecto_id) || 'Sin proyecto', r);
      else {
        const d = r.fecha_entrega;
        if (!d) poner('5', 'Sin fecha', r);
        else if (d < hoy) poner('0', 'Atrasadas', r);
        else if (d === hoy) poner('1', 'Vence hoy', r);
        else if (d === manana) poner('2', 'Vence mañana', r);
        else if (d <= finSemana) poner('3', 'Esta semana', r);
        else poner('4', 'Más adelante', r);
      }
    }
    const lista = [...m.values()].map((g) => ({ ...g, tareas: g.tareas.sort(orden) }));
    return f.agrupar === 'fecha'
      ? lista.sort((a, b) => a.clave.localeCompare(b.clave))
      : lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibles, f.agrupar, hoy]);

  /** Horas elegidas por persona: lo de esta mesa más lo que ya tiene elegido en otras. */
  const cargaPersonas = useMemo(() => {
    if (!carga) return [];
    const h = new Map<string, number>(Object.entries(carga.otras_mesas));
    for (const r of items)
      if (r.daily_fecha === hoy) for (const o of r.owner_agencia) h.set(o, (h.get(o) ?? 0) + (carga.horas[r.id]?.[o] ?? 0));
    return [...h.entries()]
      .filter(([, x]) => x > 0)
      .map(([id, horas]) => ({ id, nombre: npersona(id) || 'Sin nombre', horas, capacidad: carga.capacidad_dia[id] ?? null }))
      .sort((a, b) => (b.capacidad ? b.horas / b.capacidad : 0) - (a.capacidad ? a.horas / a.capacidad : 0));
  }, [carga, items, hoy, npersona]);

  async function marcar(ids: string[], dia: string | null) {
    if (!ids.length) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ guardadas: string[]; errores: { id: string; error: string }[] }>('/requerimientos/daily-seleccion', {
        method: 'POST',
        json: { ids, fecha: dia },
      });
      const ok = new Set(r.guardadas);
      setItems((xs) => xs.map((x) => (ok.has(x.id) ? { ...x, daily_fecha: dia } : x)));
      if (r.errores.length) setMsg({ tipo: 'error', texto: `${r.errores.length} no se pudieron marcar: ${r.errores[0]!.error}` });
      router.refresh();
    } catch (e) {
      setMsg({ tipo: 'error', texto: e instanceof ApiError ? e.message : 'No se pudo guardar' });
    }
    setBusy(false);
  }
  async function asignar(r: R, usuarioId: string) {
    if (!usuarioId) return;
    setBusy(true);
    setMsg(null);
    try {
      await api(`/requerimientos/${r.id}`, { method: 'PATCH', json: { owner_agencia: [usuarioId] } });
      setItems((xs) => xs.map((x) => (x.id === r.id ? { ...x, owner_agencia: [usuarioId] } : x)));
      setMsg({ tipo: 'ok', texto: `«${r.titulo_interno}» quedó con ${npersona(usuarioId)}. Ya puedes elegirla.` });
    } catch (e) {
      setMsg({ tipo: 'error', texto: e instanceof ApiError ? e.message : 'No se pudo asignar' });
    }
    setBusy(false);
  }

  const seleccionadas = items.length ? items.filter((r) => r.daily_fecha === hoy).length : seleccionadasHoy;
  const hayFiltros = !!(f.q || f.cliente || f.proyecto || f.persona || f.ejecutiva || f.chips.length);
  const clientesConTareas = [...new Set(items.map((r) => r.cliente_id))]
    .map((id) => ({ id, nombre: nc(id) }))
    .filter((c) => c.nombre)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const proyectosConTareas = [
    ...new Set(items.filter((r) => r.proyecto_id && (!f.cliente || r.cliente_id === f.cliente)).map((r) => r.proyecto_id!)),
  ]
    .map((id) => ({ id, nombre: np(id) }))
    .filter((p) => p.nombre)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const personasConTareas = [...new Set(items.flatMap((r) => r.owner_agencia))]
    .map((id) => ({ id, nombre: npersona(id) }))
    .filter((p) => p.nombre)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const ejecutivas = [...new Set(items.map(ejecutivaDe).filter((x): x is string => !!x))]
    .map((id) => ({ id, nombre: npersona(id) }))
    .filter((p) => p.nombre);
  const activasParaAsignar = personas.filter((u) => u.activo).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  return (
    <>
      <button className="btn-secondary" onClick={() => setAbierto(true)}>
        🎯 Armar el día{seleccionadas ? ` (${seleccionadas})` : ''}
      </button>
      {abierto && (
        <div className="fixed inset-0 bg-black/40 flex items-stretch justify-center p-2 sm:p-6 z-50" onClick={() => setAbierto(false)}>
          <div className="card w-full max-w-6xl flex flex-col min-h-0" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="font-semibold flex-1 min-w-48">
                  Armar el día · {fecha(hoy)} · <span className="text-brand-dark">{mesaNombre}</span>
                  <span className="ml-2 text-sm font-normal text-gray-500">{seleccionadas} elegidas</span>
                </div>
                {deAyer.length > 0 && (
                  <button
                    className="btn-secondary text-xs"
                    disabled={busy}
                    title={`Elegidas el ${fecha(ultimoDia)} y siguen abiertas`}
                    onClick={() =>
                      marcar(
                        deAyer.filter((r) => r.owner_agencia.length).map((r) => r.id),
                        hoy,
                      )
                    }
                  >
                    ↺ Traer lo del último daily ({deAyer.length})
                  </button>
                )}
                <button className="btn-primary text-sm" onClick={() => setAbierto(false)}>
                  Listo
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="input flex-1 min-w-56"
                  placeholder="Buscar: tarea, cliente, proyecto o persona (amazonas reel oscar)"
                  value={f.q}
                  onChange={(e) => cambiar({ q: e.target.value })}
                  aria-label="Buscar"
                />
                <select
                  className="input w-40"
                  value={f.cliente}
                  onChange={(e) => cambiar({ cliente: e.target.value, proyecto: '' })}
                  aria-label="Cliente"
                >
                  <option value="">Todos los clientes</option>
                  {clientesConTareas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
                <select
                  className="input w-40"
                  value={f.proyecto}
                  onChange={(e) => cambiar({ proyecto: e.target.value })}
                  aria-label="Proyecto"
                >
                  <option value="">Todos los proyectos</option>
                  {proyectosConTareas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
                <select
                  className="input w-36"
                  value={f.persona}
                  onChange={(e) => cambiar({ persona: e.target.value })}
                  aria-label="Persona"
                >
                  <option value="">Todas las personas</option>
                  <option value="sin">Sin responsable</option>
                  {personasConTareas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
                {ejecutivas.length > 1 && (
                  <select
                    className="input w-36"
                    value={f.ejecutiva}
                    onChange={(e) => cambiar({ ejecutiva: e.target.value })}
                    aria-label="Ejecutiva"
                  >
                    <option value="">Todas las ejecutivas</option>
                    {ejecutivas.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                  </select>
                )}
                <select
                  className="input w-36"
                  value={f.agrupar}
                  onChange={(e) => cambiar({ agrupar: e.target.value as Agrupar })}
                  aria-label="Agrupar por"
                >
                  <option value="persona">Por persona</option>
                  <option value="cliente">Por cliente</option>
                  <option value="proyecto">Por proyecto</option>
                  <option value="fecha">Por fecha</option>
                  <option value="nada">Sin agrupar</option>
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {GRUPOS_CHIPS.flatMap((g, i) => [
                  ...(i ? [<span key={`sep-${g.id}`} className="mx-1 h-4 w-px bg-gray-200" aria-hidden />] : []),
                  ...g.chips.map((c) => {
                    const activo = f.chips.includes(c.id);
                    const n = base.filter(c.test).length;
                    return (
                      <button
                        key={c.id}
                        aria-pressed={activo}
                        className={`rounded-full border px-2.5 py-0.5 text-xs ${activo ? 'bg-brand text-white border-brand' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                        onClick={() => cambiar({ chips: activo ? f.chips.filter((x) => x !== c.id) : [...f.chips, c.id] })}
                      >
                        {c.label} <span className="tabular-nums opacity-70">{n}</span>
                      </button>
                    );
                  }),
                ])}
                {hayFiltros && (
                  <button
                    className="text-xs text-gray-500 underline ml-1"
                    onClick={() => cambiar({ q: '', cliente: '', proyecto: '', persona: '', ejecutiva: '', chips: [] })}
                  >
                    Limpiar filtros
                  </button>
                )}
              </div>
              {cargaPersonas.length > 0 && (
                <div className="flex flex-wrap gap-1.5 text-xs" aria-label="Carga elegida por persona">
                  {cargaPersonas.map((p) => {
                    const pasa = p.capacidad !== null && p.horas > p.capacidad;
                    return (
                      <button
                        key={p.id}
                        onClick={() => cambiar({ persona: f.persona === p.id ? '' : p.id })}
                        title="Horas elegidas para hoy, en todas sus mesas, contra lo que registra en un día de una semana fuerte"
                        className={`rounded-md px-2 py-0.5 tabular-nums ${pasa ? 'bg-red-50 text-red-700 font-semibold' : 'bg-gray-100 text-gray-700'} ${f.persona === p.id ? 'ring-1 ring-brand' : ''}`}
                      >
                        {p.nombre.split(' ')[0]} {horasTxt(p.horas)}
                        {p.capacidad !== null ? ` de ${horasTxt(p.capacidad)}` : ''}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {msg && (
              <p className={`px-4 pt-2 text-sm ${msg.tipo === 'ok' ? 'text-green-700' : 'text-red-600'}`} role="status">
                {msg.texto}
              </p>
            )}
            <div className="overflow-auto flex-1 min-h-0">
              {grupos.map((g) => {
                const elegibles = g.tareas.filter((r) => r.owner_agencia.length > 0);
                const todas = elegibles.length > 0 && elegibles.every((r) => r.daily_fecha === hoy);
                return (
                  <section key={g.clave}>
                    {f.agrupar !== 'nada' && (
                      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-gray-50 px-4 py-1.5 text-xs border-y border-gray-100">
                        <span className="font-semibold text-gray-700">
                          {g.nombre} <span className="font-normal text-gray-500">· {g.tareas.length}</span>
                        </span>
                        {elegibles.length > 0 && (
                          <button
                            className="text-brand-dark underline disabled:opacity-50"
                            disabled={busy}
                            onClick={() =>
                              marcar(
                                elegibles.map((r) => r.id),
                                todas ? null : hoy,
                              )
                            }
                          >
                            {todas ? 'Quitar todas' : 'Elegir todas'}
                          </button>
                        )}
                      </div>
                    )}
                    <div className="divide-y divide-gray-100">
                      {g.tareas.map((r) => {
                        const elegida = r.daily_fecha === hoy;
                        const h = f.agrupar === 'persona' ? carga?.horas[r.id]?.[g.clave] : undefined;
                        return (
                          <div key={r.id} className={`flex items-center gap-3 px-4 py-2 text-sm ${elegida ? 'bg-brand/5' : ''}`}>
                            <input
                              id={`armar-${g.clave}-${r.id}`}
                              type="checkbox"
                              checked={elegida}
                              disabled={busy || r.owner_agencia.length === 0}
                              onChange={() => marcar([r.id], elegida ? null : hoy)}
                            />
                            <label htmlFor={`armar-${g.clave}-${r.id}`} className="flex-1 min-w-0 cursor-pointer">
                              <span className="font-medium break-words">{r.titulo_interno}</span>
                              <span className="block text-xs text-gray-500">
                                {nc(r.cliente_id)}
                                {np(r.proyecto_id) ? ` · ${np(r.proyecto_id)}` : ''}
                                {r.owner_agencia.length ? ` · 👤 ${r.owner_agencia.map(npersona).filter(Boolean).join(', ')}` : ''}
                              </span>
                            </label>
                            {r.owner_agencia.length === 0 && (
                              <select
                                className="input w-36 text-xs"
                                disabled={busy}
                                value=""
                                onChange={(e) => asignar(r, e.target.value)}
                                aria-label={`Asignar responsable a ${r.titulo_interno}`}
                              >
                                <option value="">Asignar a…</option>
                                {activasParaAsignar.map((u) => (
                                  <option key={u.id} value={u.id}>
                                    {u.nombre}
                                  </option>
                                ))}
                              </select>
                            )}
                            {r.estado_aprobacion === 'pendiente_cliente' && (
                              <span className="rounded-full bg-amber-100 text-amber-800 px-2 text-[10px] font-semibold whitespace-nowrap">
                                espera al cliente
                              </span>
                            )}
                            {r.planificacion === 'urgente' && (
                              <span className="rounded-full bg-red-100 text-red-800 px-2 text-[10px] font-semibold">urgente</span>
                            )}
                            {r.planificacion === 'no_planificado' && (
                              <span className="rounded-full bg-amber-100 text-amber-800 px-2 text-[10px] font-semibold">no planif.</span>
                            )}
                            <EstadoChip estado={r.estado_operativo} />
                            {h !== undefined && (
                              <span className="text-xs text-gray-500 tabular-nums whitespace-nowrap">~{horasTxt(h)}</span>
                            )}
                            <span
                              className={`text-xs whitespace-nowrap tabular-nums ${r.dias_atraso > 0 ? 'text-red-700' : 'text-gray-500'}`}
                            >
                              {fecha(r.fecha_entrega)}
                              {r.dias_atraso > 0 ? ` · ${r.dias_atraso} d` : ''}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
              {visibles.length === 0 && (
                <p className="p-4 text-sm text-gray-400">
                  {items.length === 0
                    ? `Cargando las tareas de ${mesaNombre}…`
                    : `Sin tareas de ${mesaNombre} con esos filtros. Si una tarea de Basecamp no aparece, revisa que su lista esté en el proyecto del cliente y espera la sincronización (cada 15 min).`}
                </p>
              )}
            </div>
            <p className="px-4 py-2 text-xs text-gray-500 border-t border-gray-100">
              Lo elegido sale en «Hoy se trabaja» y en la apertura. Las horas son una estimación con el timesheet: avisan, no bloquean. La
              selección es del día; mañana empieza vacía.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
