'use client';
import { Fragment, Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import type { Cliente, Usuario, RequerimientoMetricas, Bitacora } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';
import { USUARIOS_CON_INACTIVOS, conNombrePersona } from '@/lib/personas';
import { EstadoChip } from '@/components/ui/EstadoChip';
import { fecha, fechaCorta, diaLocal, APROBACION_LABEL } from '@/lib/format';
import { hoyLocal, lunesDe, sumarDias } from '@backio/shared';
import { hrefExterno } from '@/lib/url';
import { BitacoraReq } from '@/components/backlog/Bitacora';

type Fila = RequerimientoMetricas & { ultima_nota: Bitacora | null };

const sumar = sumarDias;

/** Estatus por cliente para la reunión: tarea, responsable, estado y última observación. Reemplaza la hoja "Control de tareas". */
export default function EstatusPage() {
  return (
    <Suspense>
      <Estatus />
    </Suspense>
  );
}

function Estatus() {
  const sp = useSearchParams();
  const router = useRouter();
  const cliente = sp.get('cliente') ?? '';
  const desde = sp.get('desde') ?? lunesDe(hoyLocal());
  const hasta = sp.get('hasta') ?? sumar(lunesDe(hoyLocal()), 4);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [items, setItems] = useState<Fila[]>([]);
  const [proyectos, setProyectos] = useState<Record<string, string>>({});
  const [proyectosUrl, setProyectosUrl] = useState<Record<string, string>>({});
  const [anotando, setAnotando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [soloConNota, setSoloConNota] = useState(false);
  useEffect(() => {
    Promise.all([
      api<{ items: Cliente[] }>('/clientes'),
      api<{ items: Usuario[] }>(USUARIOS_CON_INACTIVOS),
      api<{ items: { id: string; nombre: string }[] }>('/proyectos'),
    ])
      .then(([c, u, p]) => {
        setClientes(c.items);
        setUsuarios(conNombrePersona(u.items));
        setProyectos(Object.fromEntries(p.items.map((x) => [x.id, x.nombre])));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Error'));
  }, []);
  const recargar = () =>
    api<{ items: Fila[] }>(`/requerimientos/estatus?cliente=${cliente}&desde=${desde}&hasta=${hasta}`)
      .then((r) => setItems(r.items))
      .catch(() => undefined);
  useEffect(() => {
    if (!cliente) {
      setItems([]);
      return;
    }
    setCargando(true);
    setError(null);
    api<{ items: Fila[]; proyectos_url?: Record<string, string> }>(
      `/requerimientos/estatus?cliente=${cliente}&desde=${desde}&hasta=${hasta}`,
    )
      .then((r) => {
        setItems(r.items);
        setProyectosUrl(r.proyectos_url ?? {});
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Error'))
      .finally(() => setCargando(false));
  }, [cliente, desde, hasta]);
  const ir = (p: Record<string, string>) => {
    const q = new URLSearchParams({ cliente, desde, hasta, ...p });
    router.replace(`/informes/estatus?${q.toString()}`);
  };
  const nombreU = (ids: string[]) =>
    ids
      .map((id) => usuarios.find((u) => u.id === id)?.nombre ?? '')
      .filter(Boolean)
      .join(', ') || '—';
  const clienteNombre = clientes.find((c) => c.id === cliente)?.nombre ?? '';
  const grupos = useMemo(() => {
    const m = new Map<string, Fila[]>();
    for (const r of items.filter((r) => !soloConNota || r.ultima_nota)) {
      const k = r.proyecto_id ? (proyectos[r.proyecto_id] ?? 'Proyecto') : 'Sin proyecto';
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
  }, [items, proyectos, soloConNota]);
  const resumen = {
    total: items.length,
    hechas: items.filter((r) => r.estado_operativo === 'completado').length,
    atrasadas: items.filter((r) => r.dias_atraso > 0 && r.estado_operativo !== 'completado').length,
    cliente: items.filter((r) => r.estado_aprobacion === 'pendiente_cliente').length,
    conNota: items.filter((r) => r.ultima_nota).length,
  };

  return (
    <div className="space-y-4 informe">
      <style>{`@media print { @page { size: A4 landscape; margin: 10mm; } aside, .no-print { display: none !important; } main { padding: 0 !important; } .informe { max-width: none !important; } section { break-inside: avoid; } .card { box-shadow: none !important; border: 1px solid #ddd; } }`}</style>
      <header className="no-print flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Estatus por cliente</h1>
          <p className="text-sm text-gray-500">
            La hoja de la reunión: cada tarea con su estado y la última observación de la bitácora. Imprime o guarda en PDF.
          </p>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <label className="label">Cliente</label>
            <select className="input w-64" value={cliente} onChange={(e) => ir({ cliente: e.target.value })}>
              <option value="">Elige un cliente…</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Semana desde</label>
            <input
              type="date"
              className="input"
              value={desde}
              onChange={(e) => ir({ desde: e.target.value, hasta: sumar(e.target.value, 4) })}
            />
          </div>
          <div>
            <label className="label">hasta</label>
            <input type="date" className="input" value={hasta} onChange={(e) => ir({ hasta: e.target.value })} />
          </div>
          <button className="btn-ghost" onClick={() => ir({ desde: sumar(desde, -7), hasta: sumar(hasta, -7) })} title="Semana anterior">
            ‹
          </button>
          <button className="btn-ghost" onClick={() => ir({ desde: sumar(desde, 7), hasta: sumar(hasta, 7) })} title="Semana siguiente">
            ›
          </button>
          <label className="flex items-center gap-2 text-sm pb-2">
            <input type="checkbox" checked={soloConNota} onChange={(e) => setSoloConNota(e.target.checked)} /> Solo con observación
          </label>
          <button className="btn-primary" disabled={!cliente} onClick={() => window.print()}>
            🖨 Imprimir / PDF
          </button>
        </div>
      </header>
      {error && <Alert tipo="error">{error}</Alert>}
      {!cliente && <p className="text-sm text-gray-400">Elige un cliente para armar el estatus.</p>}
      {cliente && (
        <>
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500">Control de tareas</div>
              <h2 className="text-xl font-bold">{clienteNombre}</h2>
              <div className="text-sm text-gray-500">
                Semana del {fecha(desde)} al {fecha(hasta)} · generado {fecha(diaLocal(new Date().toISOString()))}
              </div>
            </div>
            <div className="flex gap-3 text-sm">
              <div className="rounded-md border border-gray-200 px-3 py-2">
                <div className="text-xs text-gray-500">Tareas</div>
                <b>{resumen.total}</b>
              </div>
              <div className="rounded-md border border-gray-200 px-3 py-2">
                <div className="text-xs text-gray-500">Completadas</div>
                <b className="text-green-700">{resumen.hechas}</b>
              </div>
              <div className="rounded-md border border-gray-200 px-3 py-2">
                <div className="text-xs text-gray-500">Atrasadas</div>
                <b className="text-red-700">{resumen.atrasadas}</b>
              </div>
              <div className="rounded-md border border-gray-200 px-3 py-2">
                <div className="text-xs text-gray-500">Esperan al cliente</div>
                <b className="text-amber-700">{resumen.cliente}</b>
              </div>
              <div className="rounded-md border border-gray-200 px-3 py-2">
                <div className="text-xs text-gray-500">Con observación</div>
                <b>{resumen.conNota}</b>
              </div>
            </div>
          </div>
          {cargando && <p className="text-sm text-gray-400">Cargando…</p>}
          {grupos.map(([nombre, filas]) => (
            <section key={nombre} className="card overflow-hidden">
              <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 font-semibold flex justify-between">
                {filas[0]?.proyecto_id && proyectosUrl[filas[0].proyecto_id] ? (
                  <a className="hover:underline" href={hrefExterno(proyectosUrl[filas[0].proyecto_id]!)} target="_blank" rel="noreferrer">
                    {nombre} <span className="no-print text-xs font-normal text-gray-400">↗ Basecamp</span>
                  </a>
                ) : (
                  <span>{nombre}</span>
                )}
                <span className="text-gray-400 font-normal">{filas.length}</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th w-[28%]">Tarea</th>
                    <th className="th">Responsable</th>
                    <th className="th">Entrega</th>
                    <th className="th">Estado</th>
                    <th className="th">Aprobación</th>
                    <th className="th w-[34%]">Observación</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((r) => (
                    <Fragment key={r.id}>
                      <tr className={r.estado_operativo === 'completado' ? 'opacity-70' : ''}>
                        <td className="td">
                          {r.basecamp_url ? (
                            <a className="hover:underline" href={hrefExterno(r.basecamp_url)} target="_blank" rel="noreferrer">
                              {r.titulo_interno}
                            </a>
                          ) : (
                            r.titulo_interno
                          )}
                          {r.bloque_nombre && <div className="text-xs text-gray-400">{r.bloque_nombre}</div>}
                        </td>
                        <td className="td text-gray-700">{nombreU(r.owner_agencia)}</td>
                        <td
                          className={`td whitespace-nowrap ${r.dias_atraso > 0 && r.estado_operativo !== 'completado' ? 'text-red-700 font-semibold' : ''}`}
                        >
                          {fecha(r.fecha_entrega)}
                          {r.dias_atraso > 0 && r.estado_operativo !== 'completado' ? ` · ${r.dias_atraso} d` : ''}
                        </td>
                        <td className="td">
                          <EstadoChip estado={r.estado_operativo} />
                        </td>
                        <td className="td text-xs">
                          {r.estado_aprobacion === 'no_aplica' ? '' : (APROBACION_LABEL[r.estado_aprobacion] ?? r.estado_aprobacion)}
                        </td>
                        <td className="td text-xs whitespace-pre-wrap">
                          {r.ultima_nota ? (
                            <>
                              <span className="text-gray-400">{fechaCorta(diaLocal(r.ultima_nota.created_at))} · </span>
                              {r.ultima_nota.nota}
                            </>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                          <button
                            type="button"
                            className="no-print block mt-1 text-xs text-brand hover:underline"
                            onClick={() => setAnotando(anotando === r.id ? null : r.id)}
                          >
                            {anotando === r.id ? 'Cerrar' : '+ Observación'}
                          </button>
                        </td>
                      </tr>
                      {anotando === r.id && (
                        <tr className="no-print">
                          <td className="td bg-gray-50" colSpan={6}>
                            <BitacoraReq
                              compacto
                              requerimientoId={r.id}
                              usuarios={usuarios}
                              visibleCliente={r.visible_cliente}
                              puedeComentar={!!r.basecamp_url}
                              onCambio={() => void recargar()}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
          {!cargando && items.length === 0 && <p className="text-sm text-gray-400">Sin tareas activas ni completadas en esa semana.</p>}
          <p className="text-xs text-gray-400">
            Generado por BackIO · La observación es la última nota de la bitácora hasta el {fecha(hasta)}.
          </p>
        </>
      )}
    </div>
  );
}
