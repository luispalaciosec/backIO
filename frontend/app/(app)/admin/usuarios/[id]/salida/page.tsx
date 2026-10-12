'use client';
import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';
import { fecha, hoyLocal } from '@/lib/format';

interface TareaInv {
  id: string;
  titulo: string;
  proyecto: string | null;
  fecha_entrega: string | null;
  estado: string;
  en_daily: boolean;
  en_basecamp: boolean;
  heredada: boolean;
  otros_responsables: string[];
  propuesto: string | null;
}
interface Inventario {
  persona: { id: string; nombre: string; rol: string };
  destinos: { id: string; nombre: string }[];
  clientes: { cliente_id: string; cliente: string; propuesto: string | null; tareas: TareaInv[] }[];
  proyectos: { id: string; nombre: string; cliente: string; propuesto: string | null }[];
  mesas: { id: string; nombre: string; propuesto: string | null }[];
  acuerdos: { id: string; descripcion: string; fecha_compromiso: string; propuesto: string | null }[];
  recurrencias: { id: string; nombre: string; cliente: string; propuesto: string | null }[];
  api_keys: number;
}
interface Resultado {
  tareas: number;
  proyectos: number;
  mesas: number;
  acuerdos: number;
  recurrencias: number;
  api_keys_revocadas: number;
  heredadas: number;
  auth_bloqueado: boolean;
  auth_error: string | null;
  basecamp: { actualizados: number; sin_cambios: number; errores: { requerimientoId: string; error: string }[] };
}

/** Destino elegido: id de persona, o '' = nadie. */
type Destinos = Record<string, string>;
const inicial = (items: { id: string; propuesto: string | null }[]): Destinos =>
  Object.fromEntries(items.map((i) => [i.id, i.propuesto ?? '']));

function SelectorPersona({
  valor,
  personas,
  onChange,
  permitirNadie,
  etiqueta,
}: {
  valor: string;
  personas: Inventario['destinos'];
  onChange: (v: string) => void;
  permitirNadie: boolean;
  etiqueta: string;
}) {
  return (
    <select className="input py-1 text-sm" aria-label={etiqueta} value={valor} onChange={(e) => onChange(e.target.value)}>
      <option value="">{permitirNadie ? 'Nadie (sin responsable)' : 'Elige a alguien…'}</option>
      {personas.map((p) => (
        <option key={p.id} value={p.id}>
          {p.nombre}
        </option>
      ))}
    </select>
  );
}

export default function SalidaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [inv, setInv] = useState<Inventario | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fechaSalida, setFechaSalida] = useState(hoyLocal());
  const [motivo, setMotivo] = useState('');
  const [tareas, setTareas] = useState<Destinos>({});
  const [proyectos, setProyectos] = useState<Destinos>({});
  const [mesas, setMesas] = useState<Destinos>({});
  const [acuerdos, setAcuerdos] = useState<Destinos>({});
  const [recurrencias, setRecurrencias] = useState<Destinos>({});
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  useEffect(() => {
    api<Inventario>(`/admin/usuarios/${id}/salida`)
      .then((r) => {
        setInv(r);
        setTareas(inicial(r.clientes.flatMap((g) => g.tareas)));
        setProyectos(inicial(r.proyectos));
        setMesas(inicial(r.mesas));
        setAcuerdos(inicial(r.acuerdos));
        setRecurrencias(inicial(r.recurrencias));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudo cargar lo que tiene a su nombre'));
  }, [id]);

  const nombre = useMemo(() => new Map((inv?.destinos ?? []).map((d) => [d.id, d.nombre])), [inv]);
  const todasLasTareas = useMemo(() => inv?.clientes.flatMap((g) => g.tareas) ?? [], [inv]);

  // Lo que falta decidir antes de confirmar.
  const faltan = useMemo(() => {
    const f: string[] = [];
    const sinDaily = todasLasTareas.filter((t) => t.en_daily && !tareas[t.id]).length;
    if (sinDaily) f.push(`${sinDaily} ${sinDaily === 1 ? 'tarea del daily necesita' : 'tareas del daily necesitan'} responsable`);
    const sinAcuerdo = (inv?.acuerdos ?? []).filter((a) => !acuerdos[a.id]).length;
    if (sinAcuerdo) f.push(`${sinAcuerdo} ${sinAcuerdo === 1 ? 'acuerdo necesita' : 'acuerdos necesitan'} responsable`);
    return f;
  }, [todasLasTareas, tareas, inv, acuerdos]);

  // Resumen: cuántas tareas van a cada persona.
  const reparto = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of todasLasTareas) m.set(tareas[t.id] ?? '', (m.get(tareas[t.id] ?? '') ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [todasLasTareas, tareas]);
  const enBasecamp = todasLasTareas.filter((t) => t.en_basecamp).length;
  const heredadas = todasLasTareas.filter((t) => t.heredada && tareas[t.id]).length;

  function asignarGrupo(clienteId: string, a: string) {
    const g = inv?.clientes.find((x) => x.cliente_id === clienteId);
    if (!g) return;
    setTareas((prev) => ({ ...prev, ...Object.fromEntries(g.tareas.map((t) => [t.id, t.en_daily && !a ? (prev[t.id] ?? '') : a])) }));
  }
  const alternar = (clienteId: string) =>
    setAbiertos((s) => {
      const n = new Set(s);
      if (n.has(clienteId)) n.delete(clienteId);
      else n.add(clienteId);
      return n;
    });

  async function confirmar() {
    if (!inv) return;
    const total = todasLasTareas.length;
    if (
      !confirm(
        `Registrar la salida de ${inv.persona.nombre}: ${total} ${total === 1 ? 'tarea pasa' : 'tareas pasan'} a otras personas, ` +
          `se cambian ${enBasecamp} to-dos en Basecamp y se cierra su acceso. ¿Continuar?`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    const lista = (d: Destinos) => Object.entries(d).map(([k, v]) => ({ id: k, a: v || null }));
    try {
      setResultado(
        await api<Resultado>(`/admin/usuarios/${id}/salida`, {
          method: 'POST',
          json: {
            fecha_salida: fechaSalida,
            motivo: motivo.trim() || null,
            tareas: lista(tareas),
            proyectos: lista(proyectos),
            mesas: lista(mesas),
            acuerdos: Object.entries(acuerdos).map(([k, v]) => ({ id: k, a: v })),
            recurrencias: lista(recurrencias),
          },
        }),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo registrar la salida');
    } finally {
      setBusy(false);
    }
  }

  if (resultado && inv) {
    const bcErr = resultado.basecamp.errores.length;
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="text-2xl font-bold">Salida registrada</h1>
        <Alert tipo={bcErr || !resultado.auth_bloqueado ? 'warn' : 'ok'}>
          {inv.persona.nombre} ya no tiene acceso. {resultado.tareas} tareas, {resultado.proyectos} proyectos, {resultado.mesas} mesas,{' '}
          {resultado.acuerdos} acuerdos y {resultado.recurrencias} recurrencias pasaron a otras personas
          {resultado.heredadas > 0 && ` (${resultado.heredadas} heredadas: su atraso no cuenta para nadie)`}. Basecamp:{' '}
          {resultado.basecamp.actualizados} to-dos actualizados
          {bcErr > 0 && `, ${bcErr} sin actualizar (termínalos en Admin → Mantenimiento → «Responsables perdidos en Basecamp»)`}.
          {!resultado.auth_bloqueado && ` No se pudo bloquear el ingreso en Supabase Auth (${resultado.auth_error}); revísalo allí.`}
        </Alert>
        <Link href="/admin/usuarios" className="btn-secondary inline-block">
          Volver a Usuarios
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-6">
      <header className="space-y-1">
        <Link href="/admin/usuarios" className="text-sm text-brand">
          ← Usuarios
        </Link>
        <h1 className="text-2xl font-bold">Salida de {inv?.persona.nombre ?? '…'}</h1>
        <p className="text-sm text-gray-500 max-w-3xl">
          Reparte lo que tiene abierto y cierra su acceso. Su historia no se toca: lo que cerró sigue siendo suyo en KPIs, cumplimiento e
          informes, y su nombre se sigue viendo con «(ex)». Una tarea que recibe alguien con menos de 3 días hábiles para la entrega queda
          «heredada»: si se cierra tarde, ese atraso no cuenta para nadie.
        </p>
      </header>

      {error && <Alert tipo="error">{error}</Alert>}
      {!inv && !error && <div className="text-sm text-gray-500">Cargando lo que tiene a su nombre…</div>}

      {inv && (
        <>
          <section className="card p-5 grid gap-4 sm:grid-cols-[180px_1fr]">
            <label className="text-sm space-y-1">
              <span className="text-gray-600">Fecha de salida</span>
              <input type="date" className="input" value={fechaSalida} max={hoyLocal()} onChange={(e) => setFechaSalida(e.target.value)} />
            </label>
            <label className="text-sm space-y-1">
              <span className="text-gray-600">Motivo (opcional, queda en la auditoría)</span>
              <input
                className="input"
                maxLength={300}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Renuncia, fin de contrato…"
              />
            </label>
          </section>

          <section className="space-y-3">
            <h2 className="font-semibold text-lg">
              Tareas abiertas <span className="text-gray-400 font-normal">({todasLasTareas.length})</span>
            </h2>
            {inv.clientes.length === 0 && <div className="text-sm text-gray-500">No tiene tareas abiertas.</div>}
            {inv.clientes.map((g) => {
              const valores = new Set(g.tareas.map((t) => tareas[t.id] ?? ''));
              const comun = valores.size === 1 ? [...valores][0]! : '';
              return (
                <div key={g.cliente_id} className="card p-4 space-y-2">
                  <div className="flex flex-wrap items-center gap-3 justify-between">
                    <button
                      type="button"
                      className="text-left"
                      onClick={() => alternar(g.cliente_id)}
                      aria-expanded={abiertos.has(g.cliente_id)}
                    >
                      <span className="font-medium">{g.cliente}</span>{' '}
                      <span className="text-sm text-gray-500">
                        · {g.tareas.length} {g.tareas.length === 1 ? 'tarea' : 'tareas'} {abiertos.has(g.cliente_id) ? '▾' : '▸'}
                      </span>
                    </button>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-gray-500">{valores.size > 1 ? 'Varios destinos · todas a' : 'Todas a'}</span>
                      <SelectorPersona
                        etiqueta={`Destino de las tareas de ${g.cliente}`}
                        valor={comun}
                        personas={inv.destinos}
                        onChange={(v) => asignarGrupo(g.cliente_id, v)}
                        permitirNadie
                      />
                    </div>
                  </div>
                  {abiertos.has(g.cliente_id) && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-left text-xs text-gray-500">
                          <tr>
                            <th className="py-1 pr-2">Tarea</th>
                            <th className="py-1 pr-2">Entrega</th>
                            <th className="py-1 pr-2">Con</th>
                            <th className="py-1">Pasa a</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.tareas.map((t) => (
                            <tr key={t.id} className="border-t">
                              <td className="py-1.5 pr-2">
                                {t.titulo}
                                {t.proyecto && <span className="text-gray-400"> · {t.proyecto}</span>}
                                <span className="ml-1 inline-flex gap-1">
                                  {t.en_daily && <span className="rounded bg-blue-50 text-blue-800 px-1.5 text-xs">daily</span>}
                                  {t.heredada && tareas[t.id] && (
                                    <span
                                      className="rounded bg-amber-50 text-amber-900 px-1.5 text-xs"
                                      title="Menos de 3 días hábiles o vencida"
                                    >
                                      heredada
                                    </span>
                                  )}
                                </span>
                              </td>
                              <td className="py-1.5 pr-2 whitespace-nowrap tabular-nums">{fecha(t.fecha_entrega)}</td>
                              <td className="py-1.5 pr-2 text-gray-500">{t.otros_responsables.join(', ') || '—'}</td>
                              <td className="py-1.5">
                                <SelectorPersona
                                  etiqueta={`Destino de ${t.titulo}`}
                                  valor={tareas[t.id] ?? ''}
                                  personas={inv.destinos}
                                  onChange={(v) => setTareas((p) => ({ ...p, [t.id]: v }))}
                                  permitirNadie={!t.en_daily}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </section>

          {(
            [
              [
                'Proyectos donde es la ejecutiva',
                inv.proyectos.map((p) => ({ id: p.id, texto: `${p.nombre} · ${p.cliente}` })),
                proyectos,
                setProyectos,
                true,
              ],
              ['Mesas que lidera', inv.mesas.map((m) => ({ id: m.id, texto: m.nombre })), mesas, setMesas, true],
              [
                'Acuerdos pendientes del weekly',
                inv.acuerdos.map((a) => ({ id: a.id, texto: `${a.descripcion} · ${fecha(a.fecha_compromiso)}` })),
                acuerdos,
                setAcuerdos,
                false,
              ],
              [
                'Recurrencias (ejecutiva o responsable de un bloque)',
                inv.recurrencias.map((r) => ({ id: r.id, texto: `${r.nombre} · ${r.cliente}` })),
                recurrencias,
                setRecurrencias,
                true,
              ],
            ] as const
          )
            .filter(([, items]) => items.length > 0)
            .map(([titulo, items, valores, set, nadie]) => (
              <section key={titulo} className="card p-4 space-y-2">
                <h2 className="font-semibold">{titulo}</h2>
                {items.map((i) => (
                  <div
                    key={i.id}
                    className="flex flex-wrap items-center justify-between gap-3 text-sm border-t pt-2 first:border-0 first:pt-0"
                  >
                    <span>{i.texto}</span>
                    <SelectorPersona
                      etiqueta={`Destino de ${i.texto}`}
                      valor={valores[i.id] ?? ''}
                      personas={inv.destinos}
                      onChange={(v) => set((p) => ({ ...p, [i.id]: v }))}
                      permitirNadie={nadie}
                    />
                  </div>
                ))}
              </section>
            ))}

          <section className="card p-5 space-y-3">
            <h2 className="font-semibold text-lg">Resumen</h2>
            <ul className="text-sm space-y-1">
              {reparto.map(([a, n]) => (
                <li key={a || 'nadie'}>
                  <span className="tabular-nums font-medium">{n}</span> {n === 1 ? 'tarea' : 'tareas'} →{' '}
                  {a ? nombre.get(a) : <span className="text-gray-500">sin responsable</span>}
                </li>
              ))}
              {heredadas > 0 && <li className="text-amber-900">{heredadas} quedan como heredadas.</li>}
              <li>{enBasecamp} to-dos de Basecamp cambian de responsable (de a 50).</li>
              <li>
                Se bloquea su ingreso (BackIO la rechaza desde ese momento) y se{' '}
                {inv.api_keys === 1 ? 'revoca 1 API key' : `revocan ${inv.api_keys} API keys`}.
              </li>
            </ul>
            {faltan.length > 0 && <Alert tipo="warn">Falta decidir: {faltan.join(' · ')}.</Alert>}
            <button className="btn-danger" disabled={busy || faltan.length > 0} onClick={confirmar}>
              {busy ? 'Registrando…' : 'Confirmar salida'}
            </button>
          </section>
        </>
      )}
    </div>
  );
}
