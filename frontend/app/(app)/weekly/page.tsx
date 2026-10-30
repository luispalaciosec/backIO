import type { Semana, Senal, Acuerdo, Usuario, CapacidadPersona, Mesa, RequerimientoMetricas, Cliente } from '@backio/shared';
import { Fragment } from 'react';
import { apiServer } from '@/lib/api.server';
import { fecha } from '@/lib/format';
import { WeeklyActions, AcuerdoForm } from './WeeklyActions';
import { CausasPendientes } from './CausasPendientes';
import { SenalesWeekly } from './SenalesWeekly';
import { meServer, puedeEscribir } from '@/lib/me.server';
import { hoyLocal, nombrePersona } from '@backio/shared';
import { USUARIOS_CON_INACTIVOS } from '@/lib/personas';

export const dynamic = 'force-dynamic';

const BASE_CAPACIDAD = {
  ritmo: 'Su semana fuerte en el timesheet (12 semanas)',
  equipo: 'Sin timesheet suficiente: la semana fuerte del equipo',
  declarada: 'Capacidad declarada (no hay timesheet)',
} as const;

export default async function WeeklyPage({ searchParams: spP }: { searchParams: Promise<{ mesa?: string }> }) {
  const searchParams = await spP;
  const [semana, me, { items: mesas }] = await Promise.all([
    apiServer<Semana>('/semanas/actual'),
    meServer(),
    apiServer<{ items: Mesa[] }>('/mesas'),
  ]);
  const escribe = puedeEscribir(me.rol);
  // El weekly es de una mesa: señales, acuerdos y compromisos son los suyos (migración 35). «todas» = toda la agencia.
  const activas = mesas.filter((m) => m.activa);
  const todas = searchParams.mesa === 'todas';
  const mesa = todas ? null : (activas.find((m) => m.id === searchParams.mesa) ?? activas[0] ?? null);
  const deLaMesa = (a: Acuerdo) => !mesa || a.mesa_id === mesa.id;
  const [
    { items: senales },
    { items: acuerdosTodos },
    { items: abiertosTodos },
    { items: capacidad },
    { items: usuarios },
    { items: clientes },
  ] = await Promise.all([
    apiServer<{ items: Senal[] }>(`/semanas/${semana.id}/senales${mesa ? `?mesa=${mesa.id}` : ''}`),
    apiServer<{ items: Acuerdo[] }>(`/semanas/${semana.id}/acuerdos`),
    apiServer<{ items: Acuerdo[] }>('/semanas/acuerdos/abiertos'),
    apiServer<{ items: CapacidadPersona[] }>(`/semanas/${semana.id}/capacidad${mesa ? `?mesa=${mesa.id}` : ''}`),
    apiServer<{ items: Usuario[] }>(USUARIOS_CON_INACTIVOS),
    apiServer<{ items: Pick<Cliente, 'id' | 'nombre' | 'ejecutiva_id'>[] }>('/clientes'),
  ]);
  const acuerdos = acuerdosTodos.filter(deLaMesa);
  const abiertos = abiertosTodos.filter(deLaMesa);
  const { items: reqs } = await apiServer<{ items: RequerimientoMetricas[] }>('/requerimientos?activos=1');
  const titulos = Object.fromEntries(reqs.map((r) => [r.id, r.titulo_interno]));
  const clienteDeTarea = Object.fromEntries(reqs.map((r) => [r.id, r.cliente_id]));
  const nombreCliente = Object.fromEntries(clientes.map((c) => [c.id, c.nombre]));
  const ejecutivaDeCliente = Object.fromEntries(clientes.filter((c) => c.ejecutiva_id).map((c) => [c.id, c.ejecutiva_id!]));
  const nombres = Object.fromEntries(usuarios.map((u) => [u.id, nombrePersona(u)]));
  const dash = await apiServer<{
    arrastre: {
      requerimiento_id: string;
      titulo: string;
      cliente: string;
      owner: string | null;
      veces_reprogramado: number;
      fecha_original: string | null;
      fecha_actual: string | null;
      dias_arrastre: number;
    }[];
    arrastre_total?: number;
  }>(`/dashboard${mesa ? `?mesa=${mesa.id}` : ''}`);
  const nombre = (id: string) => {
    const u = usuarios.find((x) => x.id === id);
    return u ? nombrePersona(u) : '—';
  };
  const hoy = hoyLocal();
  const vencidos = abiertos.filter((a) => a.fecha_compromiso < hoy);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            Weekly · Semana {semana.numero_iso} · {mesa?.nombre ?? 'Toda la agencia'}
          </h1>
          <p className="text-sm text-gray-500">
            {fecha(semana.fecha_inicio)} – {fecha(semana.fecha_fin)} · agenda generada por el motor de señales
          </p>
          <nav className="mt-2 flex flex-wrap gap-1.5 text-xs" aria-label="Mesa">
            {activas.map((m) => (
              <a
                key={m.id}
                href={`/weekly?mesa=${m.id}`}
                className={`rounded-full px-3 py-1 border ${mesa?.id === m.id ? 'bg-brand text-white border-brand' : 'border-gray-300 hover:bg-gray-50'}`}
              >
                {m.nombre}
              </a>
            ))}
            <a
              href="/weekly?mesa=todas"
              className={`rounded-full px-3 py-1 border ${todas ? 'bg-brand text-white border-brand' : 'border-gray-300 hover:bg-gray-50'}`}
            >
              Toda la agencia
            </a>
          </nav>
        </div>
        {escribe ? (
          <WeeklyActions key={mesa?.id ?? 'todas'} semanaId={semana.id} mesa={mesa?.id ?? ''} />
        ) : (
          <span className="text-xs text-gray-400">Solo lectura · los documentos los genera operaciones</span>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section className="card">
            <div className="px-4 py-3 border-b border-gray-200 font-semibold">1. Compromisos vencidos ({vencidos.length})</div>
            <ul className="divide-y divide-gray-100">
              {vencidos.length === 0 && <li className="p-4 text-sm text-gray-400">Sin compromisos vencidos.</li>}
              {vencidos.map((a) => (
                <li key={a.id} className="p-4 text-sm flex justify-between gap-3">
                  <span>{a.descripcion}</span>
                  <span className="text-red-700 whitespace-nowrap">
                    {nombre(a.responsable_id)} · {fecha(a.fecha_compromiso)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <SenalesWeekly
            senales={senales}
            semanaId={semana.id}
            clienteDeTarea={clienteDeTarea}
            clientes={nombreCliente}
            ejecutivas={ejecutivaDeCliente}
            nombre={nombres}
            escribe={escribe}
          />

          <section className="card">
            <div className="px-4 py-3 border-b border-gray-200 font-semibold flex justify-between">
              <span>
                3. Arrastre ({dash.arrastre_total ?? dash.arrastre.length}
                {(dash.arrastre_total ?? dash.arrastre.length) > 15 ? ', se muestran los 15 más reprogramados' : ''})
              </span>
              <span className="text-xs font-normal text-gray-500">se hace, se reasigna o se mata</span>
            </div>
            <ul className="divide-y divide-gray-100">
              {dash.arrastre.length === 0 && <li className="p-4 text-sm text-gray-400">Sin arrastre.</li>}
              {dash.arrastre.slice(0, 15).map((a) => (
                <li key={a.requerimiento_id} className="p-3 text-sm flex items-center justify-between gap-3">
                  <div>
                    <div>{a.titulo}</div>
                    <div className="text-xs text-gray-500">
                      {a.cliente} · {a.owner ?? 'sin owner'} · {fecha(a.fecha_original)} → {fecha(a.fecha_actual)}
                    </div>
                  </div>
                  <div className="text-right whitespace-nowrap">
                    <div className={`font-semibold ${a.veces_reprogramado >= 2 ? 'text-red-600' : 'text-amber-600'}`}>
                      {a.veces_reprogramado}× reprog.
                    </div>
                    <div className="text-xs text-gray-500">{a.dias_arrastre} días</div>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <div className="px-4 py-3 border-b border-gray-200">
              <div className="font-semibold">4. Capacidad y riesgo de la semana</div>
              <p className="text-xs text-gray-500 mt-0.5">
                Horas estimadas con lo que cada persona tarda de verdad en una tarea (timesheet de las últimas 12 semanas), en todas sus
                mesas. Disponibles: lo que registra en una semana fuerte, por los días hábiles que quedan (sin timesheet suficiente, lo del
                equipo). Lo que no entra, por fecha, queda en riesgo.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="th">Persona</th>
                    <th className="th text-right">Tareas</th>
                    <th className="th text-right">% total</th>
                    <th className="th text-right">Horas estimadas</th>
                    <th className="th text-right">Disponibles</th>
                  </tr>
                </thead>
                <tbody>
                  {capacidad.map((c) => {
                    const exceso =
                      c.horas_estimadas !== undefined && c.capacidad_restante !== undefined && c.horas_estimadas > c.capacidad_restante;
                    return (
                      <Fragment key={c.usuario_id}>
                        <tr>
                          <td className="td">{c.nombre}</td>
                          <td className="td text-right">{c.tareas}</td>
                          <td className={`td text-right ${c.pct_del_total > 30 ? 'text-red-600 font-semibold' : ''}`}>
                            {c.pct_del_total}%
                          </td>
                          <td className={`td text-right tabular-nums ${exceso ? 'text-red-600 font-semibold' : ''}`}>
                            {c.horas_estimadas !== undefined ? `${Math.round(c.horas_estimadas)} h` : '—'}
                          </td>
                          <td
                            className="td text-right tabular-nums"
                            title={c.capacidad_base ? BASE_CAPACIDAD[c.capacidad_base] : 'Capacidad declarada'}
                          >
                            {c.capacidad_restante !== undefined ? `${Math.round(c.capacidad_restante)} h` : `${c.capacidad_semanal} h`}
                          </td>
                        </tr>
                        {!!c.en_riesgo?.length && (
                          <tr>
                            <td className="td pt-0 pb-3" colSpan={5}>
                              <div className="rounded-md bg-red-50 px-3 py-2 text-xs">
                                <div className="font-semibold text-red-700">
                                  En riesgo ({c.en_riesgo.length}): no entran en lo que le queda de la semana
                                </div>
                                <ul className="mt-1 space-y-0.5 text-gray-700">
                                  {c.en_riesgo.map((t) => (
                                    <li key={t.id}>
                                      {t.titulo} · {nombreCliente[t.cliente_id] ?? ''} · vence el {fecha(t.fecha_entrega)} · ~{t.horas} h
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {capacidad.length === 0 && (
                    <tr>
                      <td className="td text-gray-400" colSpan={5}>
                        Sin tareas esta semana.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <CausasPendientes titulos={titulos} escribe={escribe} />
          <section className="card p-4 space-y-3">
            <div className="font-semibold">Acuerdos de la sesión</div>
            <p className="text-xs text-gray-500">Cada acuerdo lleva responsable y una fecha concreta del calendario.</p>
            {escribe ? (
              <AcuerdoForm
                semanaId={semana.id}
                mesaId={mesa?.id ?? null}
                mesaNombre={mesa?.nombre ?? 'toda la agencia'}
                usuarios={usuarios.filter((u) => u.activo).map((u) => ({ id: u.id, nombre: u.nombre }))}
              />
            ) : (
              <p className="text-xs text-gray-400">Los acuerdos los registra quien dirige el weekly.</p>
            )}
            <ul className="divide-y divide-gray-100 text-sm">
              {acuerdos.map((a) => (
                <li key={a.id} className="py-2">
                  <div>{a.descripcion}</div>
                  <div className="text-xs text-gray-500">
                    {nombre(a.responsable_id)} · {fecha(a.fecha_compromiso)} · {a.estado}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
