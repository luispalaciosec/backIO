'use client';
import { useEffect, useState } from 'react';
import type { RequerimientoMetricas } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { fecha } from '@/lib/format';
import { hrefExterno } from '@/lib/url';
import { EstadoChip } from '@/components/ui/EstadoChip';

interface MiDia {
  hoy: RequerimientoMetricas[];
  vencen: RequerimientoMetricas[];
  atrasadas: RequerimientoMetricas[];
  bloqueadas: RequerimientoMetricas[];
  esperando_cliente: RequerimientoMetricas[];
  avisos_mi_dia: boolean;
  /** Solo si es ejecutiva de alguna cuenta. */
  cuentas?: { atrasadas: RequerimientoMetricas[]; esperando_cliente: (RequerimientoMetricas & { dias_esperando: number })[] };
}

/** Evento que lanza «¿Ya se entregó?» al responder: el resto de Mi día se vuelve a cargar. */
export const EVENTO_MI_DIA = 'backio:mi-dia:cambio';

function Bloque({
  titulo,
  items,
  vacio,
  detalle,
  clientes,
}: {
  titulo: string;
  items: RequerimientoMetricas[];
  vacio: string;
  detalle: (r: RequerimientoMetricas) => string;
  clientes: Record<string, string>;
}) {
  return (
    <section className="card min-w-0">
      <div className="px-4 py-3 border-b border-gray-200 font-semibold flex justify-between">
        <span>{titulo}</span>
        <span className="text-gray-400 tabular-nums">{items.length}</span>
      </div>
      <ul className="divide-y divide-gray-100 max-h-80 overflow-auto">
        {items.length === 0 && <li className="p-4 text-sm text-gray-400">{vacio}</li>}
        {items.map((r) => (
          <li key={r.id} className="px-4 py-2.5 text-sm">
            <div className="flex items-start justify-between gap-3">
              {r.basecamp_url ? (
                <a href={hrefExterno(r.basecamp_url)} target="_blank" rel="noreferrer" className="font-medium hover:underline break-words">
                  {r.titulo_interno}
                </a>
              ) : (
                <span className="font-medium break-words">{r.titulo_interno}</span>
              )}
              <EstadoChip estado={r.estado_operativo} />
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              {clientes[r.cliente_id] ?? ''} · {detalle(r)}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** El resto de «Mi día»: lo de hoy, lo que vence, lo atrasado, lo bloqueado y lo que espera al cliente. */
export function MiDiaVista({ clientes }: { clientes: Record<string, string> }) {
  const [d, setD] = useState<MiDia | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    const cargar = () =>
      api<MiDia>('/mi-dia')
        .then(setD)
        .catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudo cargar tu día'));
    void cargar();
    // Al responder «¿Ya se entregó?» se recarga todo: antes una tarea reprogramada seguía en «Atrasadas» (31/10/2026).
    window.addEventListener(EVENTO_MI_DIA, cargar);
    return () => window.removeEventListener(EVENTO_MI_DIA, cargar);
  }, []);
  async function cambiarCorreo(correo: boolean) {
    setGuardando(true);
    try {
      await api('/mi-dia/avisos', { method: 'PUT', json: { correo } });
      setD((x) => (x ? { ...x, avisos_mi_dia: correo } : x));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar');
    }
    setGuardando(false);
  }
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!d) return <p className="text-sm text-gray-500">Cargando tu día…</p>;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Bloque
          titulo="Hoy trabajas en"
          items={d.hoy}
          vacio="Nada elegido para hoy en el daily."
          detalle={(r) => `entrega ${fecha(r.fecha_entrega)}`}
          clientes={clientes}
        />
        <Bloque
          titulo="Vence hoy o mañana"
          items={d.vencen}
          vacio="Nada vence hoy ni mañana."
          detalle={(r) => `entrega ${fecha(r.fecha_entrega)}`}
          clientes={clientes}
        />
        <Bloque
          titulo="Atrasadas"
          items={d.atrasadas}
          vacio="Nada atrasado."
          detalle={(r) => `${r.dias_atraso} d de atraso${r.estado_aprobacion === 'pendiente_cliente' ? ' · espera al cliente' : ''}`}
          clientes={clientes}
        />
        <Bloque
          titulo="Bloqueadas o esperando al cliente"
          items={[...d.bloqueadas, ...d.esperando_cliente.filter((r) => !d.bloqueadas.some((b) => b.id === r.id))]}
          vacio="Nada bloqueado."
          detalle={(r) =>
            r.estado_aprobacion === 'pendiente_cliente' ? 'espera al cliente' : `bloqueada · ${r.dias_sin_movimiento} d quieta`
          }
          clientes={clientes}
        />
      </div>
      {d.cuentas && (
        <div>
          <h2 className="text-lg font-semibold mt-2">Tus cuentas</h2>
          <p className="text-xs text-gray-500 mb-2">
            Lo de tus clientes, sea de quien sea la tarea: lo atrasado y lo que espera respuesta del cliente.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <Bloque
              titulo="Atrasado en tus cuentas"
              items={d.cuentas.atrasadas}
              vacio="Nada atrasado en tus cuentas."
              detalle={(r) => `${r.dias_atraso} d de atraso`}
              clientes={clientes}
            />
            <Bloque
              titulo="Esperando al cliente: pide el feedback"
              items={d.cuentas.esperando_cliente}
              vacio="Ningún cliente nos debe respuesta."
              detalle={(r) => `espera hace ${(r as RequerimientoMetricas & { dias_esperando: number }).dias_esperando} d`}
              clientes={clientes}
            />
          </div>
        </div>
      )}
      <label className="flex items-center gap-2 text-sm text-gray-600">
        <input
          id="correo-mi-dia"
          type="checkbox"
          checked={d.avisos_mi_dia}
          disabled={guardando}
          onChange={(e) => cambiarCorreo(e.target.checked)}
        />
        Recibir «Mi día» por correo de lunes a viernes a las 07:45 (si lo desactivas, te llega igual a la campana de avisos)
      </label>
    </div>
  );
}
