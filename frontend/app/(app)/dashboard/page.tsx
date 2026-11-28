'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Mesa } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';
import { Barras, Kpi, Semaforo } from '@/components/dashboard/Charts';
import { fechaCorta, ESTADO_LABEL } from '@/lib/format';
import { COLOR_ESTADO } from '@/components/backlog/colores';
import { useAvisosCarga } from '@/lib/useAvisosCarga';
import { AvisoCarga } from '@/components/ui/AvisoCarga';
import { ComoSeCalcula } from '@/components/ui/ComoSeCalcula';

interface Dashboard {
  generado_at: string;
  mesa: { id: string; nombre: string } | null;
  kpis: Record<string, number>;
  por_cliente: {
    cliente_id: string;
    cliente: string;
    mesa: string | null;
    activos: number;
    atrasados: number;
    esperando_cliente: number;
    sin_movimiento_max: number;
    completados_30d: number;
    piezas_activas: number;
    proyectos: number;
    avance_promedio: number;
    salud: 'verde' | 'amarillo' | 'rojo';
    salud_motivos?: string[];
    horas_30d: number;
    horas_reunion_30d?: number;
    valor_cotizado_activo: number;
    pct_a_tiempo_original_30d: number | null;
    reprocesos_30d: number;
    reprogramaciones_30d: number;
  }[];
  por_persona: {
    usuario_id: string;
    nombre: string;
    activos: number;
    semana_actual: number;
    atrasados: number;
    capacidad_semanal: number;
    pct_semana: number;
    horas_30d: number;
    horas_reunion_30d?: number;
    entregados_30d: number;
    pct_a_tiempo_original_30d: number | null;
    pct_a_tiempo_vigente_30d: number | null;
    desvio_mediana_dias: number | null;
    reprogramaciones_equipo_30d: number;
    reprocesos_30d: number;
    motivo_reprogramacion_dominante: string | null;
    motivo_reproceso_dominante: string | null;
  }[];
  por_estado: { estado: string; n: number }[];
  ultimas_8_semanas: { semana_inicio: string; completados: number; piezas: number; vencian: number; a_tiempo: number }[];
  arrastre: {
    requerimiento_id: string;
    titulo: string;
    cliente: string;
    owner: string | null;
    veces_reprogramado: number;
    fecha_original: string | null;
    fecha_actual: string | null;
    dias_arrastre: number;
    estado: string;
  }[];
}

export default function DashboardPage() {
  const [d, setD] = useState<Dashboard | null>(null);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const { fallos, avisar } = useAvisosCarga();
  const [mesa, setMesa] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ items: Mesa[] }>('/mesas')
      .then((r) => setMesas(r.items.filter((m) => m.activa)))
      .catch(avisar('las mesas'));
  }, [avisar]);
  useEffect(() => {
    setD(null);
    api<Dashboard>(`/dashboard${mesa ? `?mesa=${mesa}` : ''}`)
      .then(setD)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Error'));
  }, [mesa]);

  if (error) return <Alert tipo="error">{error}</Alert>;
  const k = d?.kpis;
  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <AvisoCarga fallos={fallos} />
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-gray-500">{d ? `Actualizado ${new Date(d.generado_at).toLocaleTimeString('es-EC')}` : 'Cargando…'}</p>
        </div>
        <div className="flex items-center gap-4">
          <ComoSeCalcula>
            <p>Todo sale del backlog y del timesheet de Basecamp, no de lo que cada quien declara.</p>
            <p>
              <b>Sin movimiento:</b> tareas activas sin ningún cambio en más de 14 días. <b>A tiempo:</b> entregas de los últimos 30 días
              hechas hasta su fecha original (y hasta la vigente, después de reprogramar).
            </p>
            <p>
              <b>Requiere acción:</b> el arrastre (reprogramadas o vencidas, las más reincidentes primero) y los clientes en rojo o
              amarillo, con el porqué.
            </p>
          </ComoSeCalcula>
          <select className="input w-52" value={mesa} onChange={(e) => setMesa(e.target.value)}>
            <option value="">Toda la agencia</option>
            {mesas.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </select>
        </div>
      </header>

      {k && (
        <section aria-label="Resumen" className="grid gap-3 grid-cols-2 lg:grid-cols-5">
          <Kpi
            grande
            etiqueta="Sin movimiento más de 14 días"
            valor={k.sin_movimiento_14!}
            tono={k.sin_movimiento_14! > 0 ? 'warn' : 'ok'}
            sub={`de ${k.activos} tareas activas`}
          />
          <Kpi etiqueta="Atrasadas" valor={k.atrasados!} tono={k.atrasados! > 0 ? 'bad' : 'ok'} sub={`de ${k.activos} activas`} />
          <Kpi
            etiqueta="A tiempo · 30 días"
            valor={
              k.pct_a_tiempo_original_30d === null || k.pct_a_tiempo_original_30d === undefined ? '—' : `${k.pct_a_tiempo_original_30d}%`
            }
            tono={(k.pct_a_tiempo_original_30d ?? 100) < 70 ? 'warn' : 'ok'}
            sub={`sobre la fecha original · ${k.pct_a_tiempo_vigente_30d ?? '—'}% sobre la vigente`}
          />
          <Kpi
            etiqueta="Esperando al cliente"
            valor={k.esperando_cliente!}
            tono={k.esperando_cliente! > 0 ? 'warn' : 'neutral'}
            sub="tareas en sus manos"
          />
        </section>
      )}

      {d && k && (
        <section aria-labelledby="requiere-accion" className="space-y-3">
          <h2 id="requiere-accion" className="text-lg font-semibold">
            Requiere acción
          </h2>
          {k.huerfanos_pendientes! > 0 && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {k.huerfanos_pendientes} {k.huerfanos_pendientes === 1 ? 'to-do de Basecamp está' : 'to-dos de Basecamp están'} fuera de
              BackIO.{' '}
              <Link href="/huerfanos" className="font-semibold underline underline-offset-2">
                Revisarlos
              </Link>
            </p>
          )}
          <div className="grid gap-6 xl:grid-cols-5">
            <Arrastre filas={d.arrastre} />
            <ClientesEnAlerta clientes={d.por_cliente} />
          </div>
        </section>
      )}

      {d && k && (
        <details className="card group">
          <summary className="cursor-pointer list-none px-4 py-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <span className="font-semibold">
              <span className="inline-block transition-transform group-open:rotate-90 motion-reduce:transition-none">›</span> Producción ·
              últimos 30 días
            </span>
            <span className="text-sm text-gray-500 tabular-nums">
              {k.completados_30d} entregadas · {k.piezas_completadas_30d} piezas · {Math.round(k.horas_30d!)} h de timesheet
            </span>
          </summary>
          <div className="border-t border-gray-100 p-4 space-y-5">
            <dl className="grid gap-x-6 gap-y-3 grid-cols-2 md:grid-cols-4 text-sm">
              <Dato
                etiqueta="Activas"
                valor={k.activos!}
                sub={`${k.proyectos_activos} proyectos · ${k.avance_promedio}% de avance promedio`}
              />
              <Dato
                etiqueta="Entregadas"
                valor={k.completados_30d!}
                sub={`${k.piezas_completadas_30d} piezas · ${k.piezas_activas} en curso`}
              />
              <Dato
                etiqueta="Horas"
                valor={Math.round(k.horas_30d!)}
                sub={`timesheet${k.horas_reunion_30d ? ` · más ${Math.round(k.horas_reunion_30d)} h en reuniones` : ''}`}
              />
              <Dato
                etiqueta="Reprogramadas 2 veces o más"
                valor={k.reprogramados_2mas!}
                sub={`${k.reprogramaciones_30d ?? 0} reprogramaciones en el mes`}
              />
              <Dato etiqueta="Reprocesos" valor={k.reprocesos_30d ?? 0} sub={`${k.horas_reproceso_30d ?? 0} h de reproceso`} />
              <Dato etiqueta="Bloqueadas" valor={k.bloqueados!} />
              <Dato
                etiqueta="Fuera del weekly"
                valor={k.fuera_weekly_semana ?? 0}
                sub={`esta semana${k.pct_fuera_weekly_semana !== null && k.pct_fuera_weekly_semana !== undefined ? ` · ${k.pct_fuera_weekly_semana}% de lo nuevo` : ''} · ${k.urgentes_activos ?? 0} urgentes`}
              />
            </dl>
            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <div className="text-sm font-medium mb-2">Entregas por semana</div>
                <Barras
                  datos={d.ultimas_8_semanas.map((s) => ({
                    etiqueta: fechaCorta(s.semana_inicio),
                    valor: s.completados,
                    secundario: s.vencian,
                  }))}
                />
                <div className="grid grid-cols-8 text-center text-[10px] text-gray-500 mt-1">
                  {d.ultimas_8_semanas.map((s) => (
                    <div key={s.semana_inicio}>{s.vencian ? `${Math.round((s.a_tiempo / s.vencian) * 100)}% a tiempo` : ''}</div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-sm font-medium mb-2">Piezas entregadas por semana</div>
                <Barras
                  datos={d.ultimas_8_semanas.map((s) => ({ etiqueta: fechaCorta(s.semana_inicio), valor: s.piezas }))}
                  color="#A25DDC"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Tareas activas por estado">
              {d.por_estado.map((e) => (
                <span key={e.estado} className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLOR_ESTADO[e.estado] }} />
                  {ESTADO_LABEL[e.estado]} <b className="tabular-nums">{e.n}</b>
                </span>
              ))}
            </div>
          </div>
        </details>
      )}

      {d && (
        <details className="card group">
          <summary className="cursor-pointer list-none px-4 py-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <span className="font-semibold">
              <span className="inline-block transition-transform group-open:rotate-90 motion-reduce:transition-none">›</span> Salud de cada
              cliente
            </span>
            <span className="text-sm text-gray-500">{d.por_cliente.length} clientes · el detalle de horas y cotizado, en su ficha</span>
          </summary>
          <div className="overflow-x-auto border-t border-gray-100">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th w-6"></th>
                  <th className="th">Cliente</th>
                  <th className="th text-right">Activas</th>
                  <th className="th text-right">Atrasadas</th>
                  <th className="th text-right">Esperan al cliente</th>
                  <th className="th text-right">Días sin movimiento (máx.)</th>
                  <th className="th text-right" title="Entregadas a tiempo sobre la fecha original, 30 días">
                    A tiempo
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.por_cliente.map((c) => (
                  <tr key={c.cliente_id} className="hover:bg-gray-50">
                    <td className="td">
                      <Semaforo salud={c.salud} motivos={c.salud_motivos} />
                    </td>
                    <td className="td">
                      <Link className="hover:underline" href={`/clientes/${c.cliente_id}`}>
                        {c.cliente}
                      </Link>
                      {c.mesa && <div className="text-[10px] text-gray-400">{c.mesa}</div>}
                    </td>
                    <td className="td text-right tabular-nums">{c.activos}</td>
                    <td className={`td text-right tabular-nums ${c.atrasados ? 'text-red-600 font-semibold' : ''}`}>{c.atrasados || ''}</td>
                    <td className={`td text-right tabular-nums ${c.esperando_cliente ? 'text-amber-600' : ''}`}>
                      {c.esperando_cliente || ''}
                    </td>
                    <td className={`td text-right tabular-nums ${c.sin_movimiento_max > 14 ? 'text-amber-600 font-semibold' : ''}`}>
                      {c.sin_movimiento_max}
                    </td>
                    <td className={`td text-right tabular-nums ${(c.pct_a_tiempo_original_30d ?? 100) < 70 ? 'text-red-700' : ''}`}>
                      {c.pct_a_tiempo_original_30d === null ? '' : `${c.pct_a_tiempo_original_30d}%`}
                    </td>
                  </tr>
                ))}
                {d.por_cliente.length === 0 && (
                  <tr>
                    <td className="td text-gray-400" colSpan={7}>
                      Sin actividad.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {d && (
        <p className="text-sm text-gray-500">
          La carga de cada persona está en{' '}
          <Link href="/personas" className="text-brand hover:underline">
            Personas
          </Link>
          .
        </p>
      )}
    </div>
  );
}

type Fila<K extends keyof Dashboard> = Dashboard[K] extends (infer T)[] ? T : never;
const ARRASTRE_VISIBLE = 10;

/** Lo más reincidente del arrastre; el resto, a un clic. */
function Arrastre({ filas }: { filas: Fila<'arrastre'>[] }) {
  const fila = (a: Fila<'arrastre'>) => (
    <li key={a.requerimiento_id} className="px-4 py-2.5 grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5">
      <span className="min-w-0 truncate" title={a.titulo}>
        {a.titulo}
      </span>
      <span
        className={`text-right tabular-nums text-sm ${a.veces_reprogramado >= 2 ? 'text-red-600 font-semibold' : 'text-gray-600'}`}
        title="Veces reprogramada"
      >
        {a.veces_reprogramado ? `${a.veces_reprogramado}× reprog.` : 'vencida'}
      </span>
      <span className="text-xs text-gray-500 min-w-0 truncate">
        {a.cliente} · {a.owner ?? 'sin responsable'}
      </span>
      <span className="text-right text-xs text-gray-500 tabular-nums">
        {fechaCorta(a.fecha_original)} → {fechaCorta(a.fecha_actual)} · {a.dias_arrastre} d
      </span>
    </li>
  );
  return (
    <div className="card overflow-hidden xl:col-span-3">
      <div className="px-4 py-3 border-b border-gray-200 flex items-baseline justify-between gap-3">
        <span className="font-semibold">Arrastre</span>
        <span className="text-sm text-gray-500 tabular-nums">{filas.length} tareas, las más reincidentes primero</span>
      </div>
      {filas.length === 0 ? (
        <p className="px-4 py-3 text-sm text-gray-500">Sin arrastre. Así debería verse siempre.</p>
      ) : (
        <>
          <ul className="divide-y divide-gray-100">{filas.slice(0, ARRASTRE_VISIBLE).map(fila)}</ul>
          {filas.length > ARRASTRE_VISIBLE && (
            <details className="border-t border-gray-100">
              <summary className="cursor-pointer px-4 py-2 text-sm text-brand hover:underline">
                Ver las otras {filas.length - ARRASTRE_VISIBLE}
              </summary>
              <ul className="divide-y divide-gray-100">{filas.slice(ARRASTRE_VISIBLE).map(fila)}</ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}

/** Clientes en rojo y amarillo, con el porqué. Los verdes no piden nada. */
function ClientesEnAlerta({ clientes }: { clientes: Fila<'por_cliente'>[] }) {
  const alerta = clientes.filter((c) => c.salud !== 'verde');
  return (
    <div className="card overflow-hidden xl:col-span-2 self-start">
      <div className="px-4 py-3 border-b border-gray-200 flex items-baseline justify-between gap-3">
        <span className="font-semibold">Clientes en alerta</span>
        <span className="text-sm text-gray-500 tabular-nums">
          {alerta.length} de {clientes.length}
        </span>
      </div>
      {alerta.length === 0 ? (
        <p className="px-4 py-3 text-sm text-gray-500">Todos los clientes en verde.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {alerta.map((c) => (
            <li key={c.cliente_id} className="px-4 py-2.5 flex gap-3">
              <span className="pt-1">
                <Semaforo salud={c.salud} motivos={c.salud_motivos} />
              </span>
              <span className="min-w-0">
                <Link className="hover:underline font-medium" href={`/clientes/${c.cliente_id}`}>
                  {c.cliente}
                </Link>
                {!!c.salud_motivos?.length && <span className="block text-xs text-gray-600">{c.salud_motivos.join(' · ')}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Dato({ etiqueta, valor, sub }: { etiqueta: string; valor: number | string; sub?: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{etiqueta}</dt>
      <dd className="text-xl font-semibold tabular-nums">{valor}</dd>
      {sub && <dd className="text-xs text-gray-500">{sub}</dd>}
    </div>
  );
}
