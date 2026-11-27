'use client';
import { useState } from 'react';
import { hoyLocal, sumarDias, type MotivoReprogramacion } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { fecha } from '@/lib/format';
import { MotivoReprogramacionModal } from '@/components/backlog/MotivoReprogramacion';

export interface PendienteCierre {
  id: string;
  titulo: string;
  cliente: string;
  owner: string;
  fecha_actual: string | null;
  fecha_original: string | null;
  veces: number;
}

/**
 * En la vista previa del cierre: lo elegido que vencía hoy y no se cerró. Si salió otra prioridad, se le da nueva fecha
 * con motivo ahí mismo (pedido del 27/11); queda como reprogramación y el mensaje del cierre se vuelve a armar.
 */
export function PendientesCierre({ pendientes, onCambio }: { pendientes: PendienteCierre[]; onCambio: () => Promise<void> }) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const [nueva, setNueva] = useState(sumarDias(hoyLocal(), 1));
  const [motivo, setMotivo] = useState<PendienteCierre | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!pendientes.length) return null;
  const manana = sumarDias(hoyLocal(), 1);
  return (
    <section className="px-5 py-3 border-b border-gray-200 text-sm space-y-2" aria-label="Vencían hoy y no se cerraron">
      <div>
        <div className="font-medium">
          Vencían hoy y no se cerraron <span className="text-gray-500 tabular-nums">({pendientes.length})</span>
        </div>
        <p className="text-xs text-gray-500">
          Si salió otra prioridad, dales nueva fecha con su motivo antes de publicar. Lo que se entrega otro día ya va como «en curso».
        </p>
      </div>
      <ul className="divide-y divide-gray-100">
        {pendientes.map((p) => (
          <li key={p.id} className="py-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="min-w-0">
              <span className="text-gray-500">{p.cliente} · </span>
              {p.titulo}
              <span className="text-gray-500">
                {' '}
                · {p.owner} · {fecha(p.fecha_actual)}
              </span>
            </span>
            {abierta === p.id ? (
              <span className="flex items-center gap-1">
                <label className="sr-only" htmlFor={`nueva-${p.id}`}>
                  Nueva fecha de entrega
                </label>
                <input
                  id={`nueva-${p.id}`}
                  type="date"
                  className="input py-1 text-xs w-auto"
                  min={manana}
                  value={nueva}
                  onChange={(e) => setNueva(e.target.value)}
                />
                <button type="button" className="btn-primary text-xs py-1" disabled={!nueva || nueva < manana} onClick={() => setMotivo(p)}>
                  Continuar
                </button>
                <button type="button" className="btn-ghost text-xs py-1" onClick={() => setAbierta(null)}>
                  Cancelar
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="btn-secondary text-xs py-1"
                onClick={() => {
                  setAbierta(p.id);
                  setNueva(manana);
                  setError(null);
                }}
              >
                Nueva fecha
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
      {motivo && (
        <MotivoReprogramacionModal
          titulo={motivo.titulo}
          fechaOriginal={motivo.fecha_original}
          fechaAnterior={motivo.fecha_actual}
          fechaNueva={nueva}
          veces={motivo.veces}
          onCancelar={() => setMotivo(null)}
          onConfirmar={async (m: MotivoReprogramacion, obs: string | null) => {
            try {
              await api(`/requerimientos/${motivo.id}`, {
                method: 'PATCH',
                json: { fecha_entrega: nueva, motivo_reprogramacion: m, observacion_reprogramacion: obs },
              });
              setMotivo(null);
              setAbierta(null);
              await onCambio();
            } catch (e) {
              setMotivo(null);
              setError(e instanceof ApiError ? e.message : 'No se pudo guardar la nueva fecha');
            }
          }}
        />
      )}
    </section>
  );
}
