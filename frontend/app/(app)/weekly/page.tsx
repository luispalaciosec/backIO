import type { Semana, ProyectosWeekly, Acuerdo, Usuario, CapacidadPersona, Mesa, RequerimientoMetricas, Cliente } from '@backio/shared';
import { Fragment } from 'react';
import { apiServer } from '@/lib/api.server';
import { fecha } from '@/lib/format';
import { WeeklyActions, AcuerdoForm } from './WeeklyActions';
import { CausasPendientes } from './CausasPendientes';
import { SenalesWeekly } from './SenalesWeekly';
import { CompromisosWeekly } from './CompromisosWeekly';
import { ProyectosWeeklyVista } from './ProyectosWeekly';
import { PlanSemana } from './PlanSemana';
import { BloquesWeekly } from './BloquesWeekly';
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
  // «Mis cuentas»: las cuentas de la ejecutiva, de cualquier mesa. Es para revisar y actuar; los documentos salen por mesa.
  const cuentas = searchParams.mesa === 'cuentas';
  const todas = searchParams.mesa === 'todas' || cuentas;
  const mesa = todas ? null : (activas.find((m) => m.id === searchParams.mesa) ?? activas[0] ?? null);
  const deLaMesa = (a: Acuerdo) => !mesa || a.mesa_id === mesa.id;
  const [agenda, { items: acuerdosTodos }, { items: abiertosTodos }, { items: capacidad }, { items: usuarios }, { items: clientes }] =
    await Promise.all([
      apiServer<ProyectosWeekly>(
        `/semanas/${semana.id}/proyectos${mesa ? `?mesa=${mesa.id}` : cuentas && me.usuario_id ? `?ejecutiva=${me.usuario_id}` : ''}`,
      ),
      apiServer<{ items: Acuerdo[] }>(`/semanas/${semana.id}/acuerdos`),
      apiServer<{ items: Acuerdo[] }>('/semanas/acuerdos/abiertos'),
      apiServer<{ items: CapacidadPersona[] }>(`/semanas/${semana.id}/capacidad${mesa ? `?mesa=${mesa.id}` : ''}`),
      apiServer<{ items: Usuario[] }>(USUARIOS_CON_INACTIVOS),
      apiServer<{ items: Pick<Cliente, 'id' | 'nombre' | 'ejecutiva_id' | 'mesa_id'>[] }>('/clientes'),
    ]);
  const misClientes = clientes.filter((c) => !!me.usuario_id && c.ejecutiva_id === me.usuario_id);
  const misClientesIds = misClientes.map((c) => c.id);
  const tieneCuentas = misClientes.length > 0;
  const { items: reqs } = await apiServer<{ items: RequerimientoMetricas[] }>('/requerimientos?activos=1');
  const deMisCuentas = (a: Acuerdo) =>
    a.responsable_id === me.usuario_id ||
    (!!a.requerimiento_id && misClientesIds.includes(reqs.find((r) => r.id === a.requerimiento_id)?.cliente_id ?? '')) ||
    (!!a.proyecto_id && agenda.clientes.some((c) => c.proyectos.some((p) => p.proyecto_id === a.proyecto_id)));
  const acuerdos = acuerdosTodos.filter(deLaMesa).filter((a) => !cuentas || deMisCuentas(a));
  const abiertos = abiertosTodos.filter(deLaMesa).filter((a) => !cuentas || deMisCuentas(a));
  const titulos = Object.fromEntries(reqs.map((r) => [r.id, r.titulo_interno]));
  const ownersDeTarea = Object.fromEntries(reqs.map((r) => [r.id, r.owner_agencia]));
  const activos = usuarios.filter((u) => u.activo).map((u) => ({ id: u.id, nombre: u.nombre }));
  const clienteDeTarea = Object.fromEntries(reqs.map((r) => [r.id, r.cliente_id]));
  const nombreCliente = Object.fromEntries(clientes.map((c) => [c.id, c.nombre]));
  const mesaDeCliente = Object.fromEntries(clientes.filter((c) => c.mesa_id).map((c) => [c.id, c.mesa_id!]));
  const ejecutivaDeCliente = Object.fromEntries(clientes.filter((c) => c.ejecutiva_id).map((c) => [c.id, c.ejecutiva_id!]));
  const nombres = Object.fromEntries(usuarios.map((u) => [u.id, nombrePersona(u)]));
  // En «Mis cuentas», la capacidad muestra a quienes tienen tareas de esas cuentas y solo el riesgo de ellas.
  const personasDeMisCuentas = new Set(reqs.filter((r) => misClientesIds.includes(r.cliente_id)).flatMap((r) => r.owner_agencia));
  const capacidadVista = cuentas
    ? capacidad
        .filter((c) => personasDeMisCuentas.has(c.usuario_id))
        .map((c) => ({ ...c, en_riesgo: c.en_riesgo?.filter((t) => misClientesIds.includes(t.cliente_id)) }))
    : capacidad;
  const nombre = (id: string) => nombres[id] ?? '—';
  const hoy = hoyLocal();
  const vencidos = abiertos.filter((a) => a.fecha_compromiso < hoy);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            Weekly · Semana {semana.numero_iso} · {cuentas ? 'Mis cuentas' : (mesa?.nombre ?? 'Toda la agencia')}
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
              className={`rounded-full px-3 py-1 border ${todas && !cuentas ? 'bg-brand text-white border-brand' : 'border-gray-300 hover:bg-gray-50'}`}
            >
              Toda la agencia
            </a>
            {tieneCuentas && (
              <a
                href="/weekly?mesa=cuentas"
                className={`rounded-full px-3 py-1 border ${cuentas ? 'bg-brand text-white border-brand' : 'border-gray-300 hover:bg-gray-50'}`}
              >
                Mis cuentas
              </a>
            )}
          </nav>
        </div>
        {cuentas ? (
          <span className="text-xs text-gray-400">Los documentos se generan desde el weekly de cada mesa</span>
        ) : escribe ? (
          <WeeklyActions key={mesa?.id ?? 'todas'} semanaId={semana.id} mesa={mesa?.id ?? ''} />
        ) : (
          <span className="text-xs text-gray-400">Solo lectura · los documentos los genera operaciones</span>
        )}
      </header>

      <BloquesWeekly
        semanaId={semana.id}
        mesa={mesa?.id ?? ''}
        bloques={[
          {
            titulo: 'Compromisos',
            contenido: <CompromisosWeekly vencidos={vencidos} semanaId={semana.id} nombre={nombres} escribe={escribe} />,
          },
          {
            titulo: 'Proyectos',
            contenido: (
              <ProyectosWeeklyVista
                key={searchParams.mesa ?? ''}
                datos={agenda}
                semanaId={semana.id}
                mesaId={mesa?.id ?? null}
                mesaDeCliente={mesaDeCliente}
                nombres={nombres}
                usuarios={activos}
                escribe={escribe}
              />
            ),
          },
          {
            titulo: 'Equipo',
            contenido: (
              <div className="space-y-6">
                <section className="card">
                  <div className="px-4 py-3 border-b border-gray-200">
                    <div className="font-semibold">3. Equipo: capacidad y riesgo de la semana</div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Horas estimadas con lo que cada persona tarda de verdad en una tarea (timesheet de las últimas 12 semanas), en todas
                      sus mesas. Disponibles: lo que registra en una semana fuerte, por los días hábiles que quedan (sin timesheet
                      suficiente, lo del equipo). Lo que no entra, por fecha, queda en riesgo.
                    </p>
                  </div>
                  <PlanSemana
                    key={mesa?.id ?? 'todas'}
                    semanaId={semana.id}
                    mesa={mesa?.id ?? ''}
                    clientes={nombreCliente}
                    owners={ownersDeTarea}
                    usuarios={activos}
                    escribe={escribe}
                  />
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
                        {capacidadVista.map((c) => {
                          const exceso =
                            c.horas_estimadas !== undefined &&
                            c.capacidad_restante !== undefined &&
                            c.horas_estimadas > c.capacidad_restante;
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
                                  {c.capacidad_restante !== undefined
                                    ? `${Math.round(c.capacidad_restante)} h`
                                    : `${c.capacidad_semanal} h`}
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
                                            {t.titulo} · {nombreCliente[t.cliente_id] ?? ''} · vence el {fecha(t.fecha_entrega)} · ~
                                            {t.horas} h
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
                        {capacidadVista.length === 0 && (
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
                <SenalesWeekly
                  titulo="Otras señales: personas y cuentas"
                  senales={agenda.otras_senales}
                  semanaId={semana.id}
                  mesaId={mesa?.id ?? null}
                  clienteDeTarea={clienteDeTarea}
                  ownersDeTarea={ownersDeTarea}
                  clientes={nombreCliente}
                  ejecutivas={ejecutivaDeCliente}
                  mesaDeCliente={mesaDeCliente}
                  soloCuentasDe={cuentas ? (me.usuario_id ?? null) : null}
                  nombre={nombres}
                  usuarios={activos}
                  yo={me.usuario_id ?? null}
                  escribe={escribe}
                />
              </div>
            ),
          },
        ]}
        lateral={
          <>
            <CausasPendientes
              key={searchParams.mesa ?? ''}
              mesa={mesa?.id ?? ''}
              clientes={nombreCliente}
              misClientes={misClientesIds}
              soloMias={cuentas}
              escribe={escribe}
            />
            <section className="card p-4 space-y-3">
              <div className="font-semibold">Acuerdos de la sesión</div>
              <p className="text-xs text-gray-500">Cada acuerdo lleva responsable y una fecha concreta del calendario.</p>
              {escribe ? (
                <AcuerdoForm
                  semanaId={semana.id}
                  mesaId={mesa?.id ?? null}
                  mesaNombre={mesa?.nombre ?? 'toda la agencia'}
                  usuarios={activos}
                  tareas={reqs
                    .filter((r) => !mesa || clientes.find((c) => c.id === r.cliente_id)?.mesa_id === mesa.id)
                    .map((r) => ({ id: r.id, titulo: r.titulo_interno }))}
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
                      {a.requerimiento_id && titulos[a.requerimiento_id] ? ` · ${titulos[a.requerimiento_id]}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </>
        }
      />
    </div>
  );
}
