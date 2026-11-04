'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { hoyLocal, type MotivoReprogramacion } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { MotivoReprogramacionModal } from '@/components/backlog/MotivoReprogramacion';

export interface TareaAccion {
  id: string;
  titulo: string;
  fecha_original: string | null;
  fecha_actual: string | null;
  veces: number;
  /** Responsables actuales: reasignar cambia a una persona, no borra a las demás. */
  owners: string[];
}

export function usePatchTarea() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function patch(id: string, body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await api(`/requerimientos/${id}`, { method: 'PATCH', json: body });
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar');
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { patch, busy, error };
}

/** Las acciones del arrastre: se hace (nueva fecha), se reasigna o se mata. Todo sale a Basecamp a nombre de quien hace clic. */
export function AccionesTarea({
  tarea,
  usuarios,
  fechaSugerida,
}: {
  tarea: TareaAccion;
  usuarios: { id: string; nombre: string }[];
  fechaSugerida?: string | null;
}) {
  const { patch, busy, error } = usePatchTarea();
  const [modo, setModo] = useState<'fecha' | 'persona' | 'cancelar' | null>(null);
  const [nueva, setNueva] = useState(fechaSugerida ?? '');
  const [motivo, setMotivo] = useState(false);
  const de = tarea.owners[0];
  return (
    <div className="flex flex-col items-end gap-1 text-xs">
      <div className="flex flex-wrap justify-end gap-1">
        <button className="btn-secondary text-xs py-1" disabled={busy} onClick={() => setModo(modo === 'fecha' ? null : 'fecha')}>
          Reprogramar
        </button>
        <button className="btn-secondary text-xs py-1" disabled={busy} onClick={() => setModo(modo === 'persona' ? null : 'persona')}>
          Reasignar
        </button>
        <button
          className="btn-ghost text-xs py-1 text-red-700"
          disabled={busy}
          onClick={() => setModo(modo === 'cancelar' ? null : 'cancelar')}
        >
          Cancelar
        </button>
      </div>
      {modo === 'fecha' && (
        <div className="flex items-center gap-1">
          <input
            type="date"
            aria-label={`Nueva fecha de ${tarea.titulo}`}
            className="input py-1 text-xs w-36"
            min={hoyLocal()}
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
          />
          <button className="btn-primary text-xs py-1" disabled={!nueva || busy} onClick={() => setMotivo(true)}>
            Seguir
          </button>
        </div>
      )}
      {modo === 'persona' && (
        <select
          aria-label={`Reasignar ${tarea.titulo}`}
          className="input py-1 text-xs w-44"
          disabled={busy}
          value=""
          onChange={async (e) => {
            const a = e.target.value;
            if (!a) return;
            // Cambia al primer responsable por la persona elegida; los demás siguen.
            const owners = [...new Set(de ? tarea.owners.map((o) => (o === de ? a : o)) : [a])];
            if (await patch(tarea.id, { owner_agencia: owners })) setModo(null);
          }}
        >
          <option value="">Reasignar a…</option>
          {usuarios
            .filter((u) => !tarea.owners.includes(u.id))
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
        </select>
      )}
      {modo === 'cancelar' && (
        <div className="flex items-center gap-1 text-red-800">
          <span>Se archiva también en Basecamp.</span>
          <button
            className="btn-danger text-xs py-1"
            disabled={busy}
            onClick={async () => {
              if (await patch(tarea.id, { estado_operativo: 'cancelado' })) setModo(null);
            }}
          >
            Cancelar tarea
          </button>
        </div>
      )}
      {error && <p className="text-red-600 max-w-xs text-right">{error}</p>}
      {motivo && (
        <MotivoReprogramacionModal
          titulo={tarea.titulo}
          fechaOriginal={tarea.fecha_original}
          fechaAnterior={tarea.fecha_actual}
          fechaNueva={nueva}
          veces={tarea.veces}
          onCancelar={() => setMotivo(false)}
          onConfirmar={async (m: MotivoReprogramacion, obs: string | null) => {
            const ok = await patch(tarea.id, { fecha_entrega: nueva, motivo_reprogramacion: m, observacion_reprogramacion: obs });
            setMotivo(false);
            if (ok) setModo(null);
          }}
        />
      )}
    </div>
  );
}
