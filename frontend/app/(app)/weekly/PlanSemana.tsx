'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { fecha } from '@/lib/format';
import { AccionesTarea, usePatchTarea } from './AccionesTarea';

interface Sugerencia {
  tarea_id: string;
  titulo: string;
  cliente_id: string;
  fecha_entrega: string;
  horas: number;
  de_id: string;
  de: string;
  a_id: string | null;
  a: string | null;
  horas_libres_a: number | null;
  fecha_sugerida: string | null;
}

/** Lo que no entra esta semana, con la salida que propone BackIO: reasignar o renegociar. Nada cambia sin un clic. */
export function PlanSemana({
  semanaId,
  mesa,
  clientes,
  owners,
  usuarios,
  escribe,
  soloClientes,
}: {
  semanaId: string;
  mesa: string;
  clientes: Record<string, string>;
  owners: Record<string, string[]>;
  usuarios: { id: string; nombre: string }[];
  escribe: boolean;
  soloClientes?: string[];
}) {
  const [items, setItems] = useState<Sugerencia[] | null>(null);
  const { patch, busy, error } = usePatchTarea();
  useEffect(() => {
    let vivo = true;
    api<{ items: Sugerencia[] }>(`/semanas/${semanaId}/reparto${mesa ? `?mesa=${mesa}` : ''}`)
      .then((r) => vivo && setItems(r.items))
      .catch(() => vivo && setItems([]));
    return () => {
      vivo = false;
    };
  }, [semanaId, mesa]);
  const vistas = items?.filter((s) => !soloClientes || soloClientes.includes(s.cliente_id)) ?? [];
  if (!vistas.length) return null;
  const reasignables = vistas.filter((s) => s.a_id).length;
  return (
    <div className="border-b border-gray-200 px-4 py-3 space-y-2">
      <div className="text-sm font-semibold">
        Plan de la semana: {vistas.length} {vistas.length === 1 ? 'tarea no entra' : 'tareas no entran'}
        {reasignables ? ` · ${reasignables} se pueden reasignar` : ''}
      </div>
      <p className="text-xs text-gray-500">
        Solo se propone a quien ya trabaja con esa cuenta y tiene horas libres. Si nadie puede, toca renegociar la fecha.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <ul className="divide-y divide-gray-100 text-sm">
        {vistas.map((s) => {
          const actuales = owners[s.tarea_id] ?? [s.de_id];
          return (
            <li key={`${s.tarea_id}|${s.de_id}`} className="py-2 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div>{s.titulo}</div>
                <div className="text-xs text-gray-500">
                  {clientes[s.cliente_id] ?? ''} · vence el {fecha(s.fecha_entrega)} · ~{s.horas} h de {s.de}
                  {s.a ? ` · ${s.a} tiene ~${s.horas_libres_a} h libres` : ` · nadie con horas conoce la cuenta`}
                </div>
              </div>
              {escribe &&
                (s.a_id ? (
                  <button
                    className="btn-primary text-xs py-1"
                    disabled={busy}
                    onClick={async () => {
                      const ok = await patch(s.tarea_id, {
                        owner_agencia: [...new Set(actuales.map((o) => (o === s.de_id ? s.a_id! : o)))],
                      });
                      if (ok) setItems((xs) => xs?.filter((x) => x !== s) ?? null);
                    }}
                  >
                    Reasignar a {s.a}
                  </button>
                ) : (
                  <AccionesTarea
                    tarea={{
                      id: s.tarea_id,
                      titulo: s.titulo,
                      fecha_original: null,
                      fecha_actual: s.fecha_entrega,
                      veces: 0,
                      owners: actuales,
                    }}
                    usuarios={usuarios}
                    fechaSugerida={s.fecha_sugerida}
                  />
                ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
