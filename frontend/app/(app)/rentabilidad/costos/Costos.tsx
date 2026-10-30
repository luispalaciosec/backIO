'use client';
import { useCallback, useEffect, useState } from 'react';
import type { CostoPersonal, FeeCliente } from '@backio/shared';
import { hoyLocal } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { dinero, fecha } from '@/lib/format';

type Fila = { id: string; nombre: string; detalle?: string };
type Valor = { monto: number; desde: string; anteriores: number };

/** Valor vigente hoy y cuántos cambios anteriores tiene, por id (persona o cliente). */
function vigentes<T extends { desde: string }>(filas: T[], id: (x: T) => string, monto: (x: T) => number): Map<string, Valor> {
  const hoy = hoyLocal();
  const out = new Map<string, Valor>();
  for (const f of [...filas].filter((x) => x.desde <= hoy).sort((a, b) => b.desde.localeCompare(a.desde))) {
    const v = out.get(id(f));
    if (v) v.anteriores += 1;
    else out.set(id(f), { monto: monto(f), desde: f.desde, anteriores: 0 });
  }
  return out;
}

function Tabla({
  titulo,
  ayuda,
  filas,
  valores,
  futuros,
  etiqueta,
  guardar,
}: {
  titulo: string;
  ayuda: string;
  filas: Fila[];
  valores: Map<string, Valor>;
  futuros: Set<string>;
  etiqueta: string;
  guardar: (id: string, monto: number, desde: string) => Promise<void>;
}) {
  const [editando, setEditando] = useState<string | null>(null);
  const [monto, setMonto] = useState('');
  const [desde, setDesde] = useState(`${hoyLocal().slice(0, 7)}-01`);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [filtro, setFiltro] = useState('');

  async function enviar(f: Fila) {
    setBusy(true);
    setMsg(null);
    try {
      await guardar(f.id, Number(monto), desde);
      setMsg({ tipo: 'ok', texto: `${f.nombre}: ${dinero(Number(monto))} desde el ${fecha(desde)}.` });
      setEditando(null);
    } catch (e) {
      setMsg({ tipo: 'error', texto: e instanceof ApiError ? e.message : 'No se pudo guardar' });
    }
    setBusy(false);
  }

  const visibles = filas.filter((f) => f.nombre.toLowerCase().includes(filtro.toLowerCase()));
  return (
    <section className="card">
      <div className="px-4 py-3 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold">{titulo}</div>
          <p className="text-xs text-gray-500 mt-0.5">{ayuda}</p>
        </div>
        <input className="input text-sm" placeholder="Buscar…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
      </div>
      {msg && (
        <p className={`px-4 pt-3 text-sm ${msg.tipo === 'ok' ? 'text-green-700' : 'text-red-600'}`} role="status">
          {msg.texto}
        </p>
      )}
      <ul className="divide-y divide-gray-100">
        {visibles.map((f) => {
          const v = valores.get(f.id);
          return (
            <li key={f.id} className="px-4 py-2.5 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-medium">{f.nombre}</span>
                  {f.detalle && <span className="text-xs text-gray-500"> · {f.detalle}</span>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums text-right">
                    {v ? (
                      <>
                        <b>{dinero(v.monto)}</b>
                        <span className="text-xs text-gray-500">
                          {' '}
                          desde {fecha(v.desde)}
                          {v.anteriores ? ` · ${v.anteriores} anterior${v.anteriores > 1 ? 'es' : ''}` : ''}
                        </span>
                      </>
                    ) : (
                      <span className="text-gray-400">Sin cargar</span>
                    )}
                    {futuros.has(f.id) && <span className="block text-xs text-amber-700">hay un cambio con fecha futura</span>}
                  </span>
                  <button
                    className="btn-secondary text-xs py-1"
                    onClick={() => {
                      setEditando(editando === f.id ? null : f.id);
                      setMonto(v ? String(v.monto) : '');
                      setMsg(null);
                    }}
                  >
                    {v ? 'Cambiar' : 'Cargar'}
                  </button>
                </div>
              </div>
              {editando === f.id && (
                <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md bg-gray-50 p-3">
                  <label className="text-xs">
                    <span className="label">{etiqueta} (USD)</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="input w-36"
                      value={monto}
                      onChange={(e) => setMonto(e.target.value)}
                    />
                  </label>
                  <label className="text-xs">
                    <span className="label">Desde</span>
                    <input type="date" className="input" value={desde} onChange={(e) => setDesde(e.target.value)} />
                  </label>
                  <button
                    className="btn-primary text-xs"
                    disabled={busy || !monto || Number(monto) < 0 || !desde}
                    onClick={() => enviar(f)}
                  >
                    {busy ? 'Guardando…' : 'Guardar'}
                  </button>
                  <p className="w-full text-xs text-gray-500">
                    Un cambio no borra el anterior: vale desde la fecha que pongas. Si ya hay uno con esa misma fecha, lo reemplaza.
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Sueldos y fees (migración 41): solo gerencia y admin. */
export function Costos({ personas, clientes }: { personas: Fila[]; clientes: Fila[] }) {
  const [datos, setDatos] = useState<{ sueldos: CostoPersonal[]; fees: FeeCliente[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cargar = useCallback(async () => {
    try {
      setDatos(await api<{ sueldos: CostoPersonal[]; fees: FeeCliente[] }>('/costos'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudieron cargar los sueldos y fees');
    }
  }, []);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!datos) return <p className="text-sm text-gray-500">Cargando…</p>;
  const hoy = hoyLocal();
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Tabla
        titulo="Sueldos"
        ayuda="Sueldo mensual de cada persona. Se reparte entre sus clientes según las horas que registra en el timesheet."
        filas={personas}
        valores={vigentes(
          datos.sueldos,
          (x) => x.usuario_id,
          (x) => x.sueldo_mensual,
        )}
        futuros={new Set(datos.sueldos.filter((x) => x.desde > hoy).map((x) => x.usuario_id))}
        etiqueta="Sueldo mensual"
        guardar={async (id, monto, desde) => {
          await api('/costos/sueldos', { method: 'PUT', json: { usuario_id: id, sueldo_mensual: monto, desde } });
          await cargar();
        }}
      />
      <Tabla
        titulo="Fees de clientes"
        ayuda="Lo que paga cada cliente al mes. Sin fee, el cliente muestra su costo pero no su margen."
        filas={clientes}
        valores={vigentes(
          datos.fees,
          (x) => x.cliente_id,
          (x) => x.fee_mensual,
        )}
        futuros={new Set(datos.fees.filter((x) => x.desde > hoy).map((x) => x.cliente_id))}
        etiqueta="Fee mensual"
        guardar={async (id, monto, desde) => {
          await api('/costos/fees', { method: 'PUT', json: { cliente_id: id, fee_mensual: monto, desde } });
          await cargar();
        }}
      />
    </div>
  );
}
