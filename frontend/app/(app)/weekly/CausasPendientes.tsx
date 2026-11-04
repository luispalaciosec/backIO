'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Reprogramacion, Reproceso, MotivoReprogramacion, MotivoReproceso } from '@backio/shared';
import { MOTIVOS_REPROGRAMACION, MOTIVOS_REPROCESO, diaLocal } from '@backio/shared';
import { api } from '@/lib/api';
import { fecha } from '@/lib/format';

type ConTarea<X> = X & { titulo: string; cliente_id: string };

/** Reprogramaciones y reprocesos sin causa registrada: se completan aquí, en el weekly, sin salir a buscarlos. */
export function CausasPendientes({
  mesa,
  clientes,
  misClientes,
  soloMias = false,
  escribe,
}: {
  mesa: string;
  clientes: Record<string, string>;
  /** Clientes de los que la persona es ejecutiva. */
  misClientes: string[];
  soloMias?: boolean;
  escribe: boolean;
}) {
  const [d, setD] = useState<{ reprogramaciones: ConTarea<Reprogramacion>[]; reprocesos: ConTarea<Reproceso>[] } | null>(null);
  const [mias, setMias] = useState(soloMias);
  const cargar = useCallback(
    () =>
      api<{ reprogramaciones: ConTarea<Reprogramacion>[]; reprocesos: ConTarea<Reproceso>[] }>(
        `/requerimientos/causas-pendientes${mesa ? `?mesa=${mesa}` : ''}`,
      )
        .then(setD)
        .catch(() => setD({ reprogramaciones: [], reprocesos: [] })),
    [mesa],
  );
  useEffect(() => {
    void cargar();
  }, [cargar]);
  if (!d) return null;
  const visible = (x: { cliente_id: string }) => !mias || misClientes.includes(x.cliente_id);
  const reprogramaciones = d.reprogramaciones.filter(visible);
  const reprocesos = d.reprocesos.filter(visible);
  const n = reprogramaciones.length + reprocesos.length;
  const t = (x: ConTarea<unknown>) => (
    <>
      <b>{x.titulo}</b>
      {clientes[x.cliente_id] && <span className="text-xs text-gray-500"> · {clientes[x.cliente_id]}</span>}
    </>
  );
  return (
    <section className="card">
      <div className="px-4 py-3 border-b border-gray-200 font-semibold flex justify-between">
        <span>Causas pendientes de registrar</span>
        <span className="flex items-center gap-3 font-normal">
          {misClientes.length > 0 && !soloMias && (
            <label className="text-xs text-gray-500 flex items-center gap-1">
              <input type="checkbox" checked={mias} onChange={(e) => setMias(e.target.checked)} /> Mis cuentas
            </label>
          )}
          <span className={`font-semibold ${n ? 'text-amber-700' : 'text-gray-400'}`}>{n}</span>
        </span>
      </div>
      <ul className="divide-y divide-gray-100 text-sm">
        {n === 0 && <li className="p-4 text-gray-400">Todas las reprogramaciones y reprocesos tienen causa. Así se pueden atribuir.</li>}
        {reprogramaciones.map((x) => (
          <li key={x.id} className="p-3 flex items-center gap-3 flex-wrap">
            <span className="flex-1 min-w-48">
              {t(x)} · fecha {fecha(x.fecha_anterior)} → {fecha(x.fecha_nueva)}{' '}
              <span className="text-xs text-gray-500">
                ({x.origen}, {fecha(diaLocal(x.created_at))})
              </span>
            </span>
            {escribe ? (
              <select
                className="input w-60 py-1 text-xs border-amber-300"
                defaultValue=""
                onChange={async (e) => {
                  if (!e.target.value) return;
                  await api(`/requerimientos/reprogramaciones/${x.id}`, {
                    method: 'PATCH',
                    json: { motivo: e.target.value as MotivoReprogramacion },
                  });
                  void cargar();
                }}
              >
                <option value="">Causa de la reprogramación…</option>
                {MOTIVOS_REPROGRAMACION.map((m) => (
                  <option key={m.valor} value={m.valor}>
                    {m.label}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs text-amber-700">sin causa</span>
            )}
          </li>
        ))}
        {reprocesos.map((x) => (
          <li key={x.id} className="p-3 flex items-center gap-3 flex-wrap">
            <span className="flex-1 min-w-48">
              {t(x)} · reproceso {x.origen === 'basecamp' ? 'desmarcado en Basecamp' : x.origen}{' '}
              <span className="text-xs text-gray-500">
                ({fecha(x.abierto_at.slice(0, 10))}
                {x.cerrado_at ? '' : ', abierto'})
              </span>
            </span>
            {escribe ? (
              <select
                className="input w-60 py-1 text-xs border-amber-300"
                defaultValue=""
                onChange={async (e) => {
                  if (!e.target.value) return;
                  await api(`/requerimientos/${x.requerimiento_id}/reprocesos/${x.id}`, {
                    method: 'PATCH',
                    json: { motivo: e.target.value as MotivoReproceso },
                  });
                  void cargar();
                }}
              >
                <option value="">Causa del reproceso…</option>
                {MOTIVOS_REPROCESO.map((m) => (
                  <option key={m.valor} value={m.valor}>
                    {m.label}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs text-amber-700">sin causa</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
