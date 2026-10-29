'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Senal } from '@backio/shared';
import { diaLocal } from '@backio/shared';
import { api } from '@/lib/api';
import { fecha } from '@/lib/format';

const SEV: Record<string, string> = {
  critica: 'bg-red-100 text-red-800',
  alta: 'bg-amber-100 text-amber-800',
  media: 'bg-gray-100 text-gray-700',
};
const ORDEN = { critica: 0, alta: 1, media: 2 } as const;

interface Grupo {
  clave: string;
  nombre: string;
  senales: Senal[];
  criticas: number;
  pendientes: number;
}

/**
 * Señales del weekly agrupadas por cliente (lo que no es de un cliente va en «Equipo»), con el botón «Atendida» en cada
 * una. Una señal atendida no vuelve como nueva la semana siguiente mientras no empeore (migración 35).
 */
export function SenalesWeekly({
  senales,
  semanaId,
  clienteDeTarea,
  clientes,
  ejecutivas = {},
  nombre,
  escribe,
}: {
  senales: Senal[];
  semanaId: string;
  clienteDeTarea: Record<string, string>;
  clientes: Record<string, string>;
  /** cliente → ejecutiva de cuenta (migración 37): entra al bloque de su cuenta aunque no sea de la mesa. */
  ejecutivas?: Record<string, string>;
  nombre: Record<string, string>;
  escribe: boolean;
}) {
  const router = useRouter();
  const [ocultarAtendidas, setOcultar] = useState(true);
  const [abierto, setAbierto] = useState<Record<string, boolean>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cuentasDe, setCuentasDe] = useState('');

  const grupos = useMemo(() => {
    const m = new Map<string, Grupo>();
    for (const s of senales) {
      const cliente =
        s.entidad_tipo === 'cliente'
          ? s.entidad_id
          : s.entidad_tipo === 'requerimiento'
            ? (clienteDeTarea[s.entidad_id] ?? (s.detalle.cliente_id as string | undefined))
            : undefined;
      const clave = cliente && clientes[cliente] ? cliente : 'equipo';
      const g = m.get(clave) ?? {
        clave,
        nombre: clave === 'equipo' ? 'Equipo' : clientes[clave]!,
        senales: [],
        criticas: 0,
        pendientes: 0,
      };
      g.senales.push(s);
      if (!s.atendida) {
        g.pendientes += 1;
        if (s.severidad === 'critica') g.criticas += 1;
      }
      m.set(clave, g);
    }
    for (const g of m.values())
      g.senales.sort((a, b) => Number(a.atendida) - Number(b.atendida) || ORDEN[a.severidad] - ORDEN[b.severidad]);
    return [...m.values()].sort((a, b) => b.criticas - a.criticas || b.pendientes - a.pendientes || a.nombre.localeCompare(b.nombre));
  }, [senales, clienteDeTarea, clientes]);

  const pendientes = senales.filter((s) => !s.atendida).length;
  const conEjecutiva = [...new Set(Object.values(ejecutivas))].filter((id) => grupos.some((g) => ejecutivas[g.clave] === id));
  const visibles = grupos.filter((g) => (!ocultarAtendidas || g.pendientes > 0) && (!cuentasDe || ejecutivas[g.clave] === cuentasDe));

  async function marcar(s: Senal, atendida: boolean) {
    const clave = `${s.tipo}|${s.entidad_id}`;
    setOcupado(clave);
    setError(null);
    try {
      await api(`/semanas/${semanaId}/senales/atender`, {
        method: 'POST',
        json: {
          atendida,
          senal: {
            tipo: s.tipo,
            severidad: s.severidad,
            entidad_tipo: s.entidad_tipo,
            entidad_id: s.entidad_id,
            titulo: s.titulo,
            detalle: s.detalle,
          },
        },
      });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setOcupado(null);
    }
  }

  return (
    <section className="card">
      <div className="px-4 py-3 border-b border-gray-200 flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">
          2. Señales · {pendientes} por atender{senales.length > pendientes ? ` de ${senales.length}` : ''}
        </span>
        {conEjecutiva.length > 0 && (
          <select
            className="input w-44 text-xs"
            value={cuentasDe}
            onChange={(e) => setCuentasDe(e.target.value)}
            title="Recorrer la agenda por cuentas"
          >
            <option value="">Todas las cuentas</option>
            {conEjecutiva.map((id) => (
              <option key={id} value={id}>
                Cuentas de {nombre[id] ?? '—'}
              </option>
            ))}
          </select>
        )}
        <label className="text-xs text-gray-500 flex items-center gap-1.5">
          <input type="checkbox" checked={ocultarAtendidas} onChange={(e) => setOcultar(e.target.checked)} />
          Ocultar atendidas
        </label>
      </div>
      {error && <p className="px-4 pt-3 text-xs text-red-600">{error}</p>}
      <ul className="divide-y divide-gray-100">
        {senales.length === 0 && <li className="p-4 text-sm text-gray-400">Sin señales. Recalcula para generar la agenda.</li>}
        {senales.length > 0 && visibles.length === 0 && <li className="p-4 text-sm text-gray-400">Todas las señales están atendidas.</li>}
        {visibles.map((g) => {
          const lista = g.senales.filter((s) => !ocultarAtendidas || !s.atendida);
          // Abiertos por defecto los grupos con críticas pendientes.
          const ver = abierto[g.clave] ?? g.criticas > 0;
          return (
            <li key={g.clave}>
              <button
                type="button"
                className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-gray-50"
                onClick={() => setAbierto({ ...abierto, [g.clave]: !ver })}
                aria-expanded={ver}
              >
                <span className="font-medium text-sm">
                  {ver ? '▾' : '▸'} {g.nombre}
                  {ejecutivas[g.clave] && <span className="font-normal text-gray-500"> · {nombre[ejecutivas[g.clave]!] ?? '—'}</span>}
                </span>
                <span className="flex items-center gap-2 text-xs">
                  {g.criticas > 0 && <span className={`rounded px-2 py-0.5 font-semibold ${SEV.critica}`}>{g.criticas} críticas</span>}
                  <span className="text-gray-500">
                    {g.pendientes} por atender{g.senales.length > g.pendientes ? ` · ${g.senales.length - g.pendientes} atendidas` : ''}
                  </span>
                </span>
              </button>
              {ver && (
                <ul className="pb-2">
                  {lista.map((s) => {
                    const clave = `${s.tipo}|${s.entidad_id}`;
                    return (
                      <li key={clave} className={`px-4 py-2 pl-8 text-sm flex items-start gap-3 ${s.atendida ? 'opacity-60' : ''}`}>
                        <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${SEV[s.severidad]}`}>{s.severidad}</span>
                        <div className="flex-1 min-w-0">
                          <div className="break-words">{s.titulo}</div>
                          <div className="text-xs text-gray-500">
                            {s.tipo.replace(/_/g, ' ')}
                            {s.atendida && s.atendida_at
                              ? ` · atendida${s.atendida_por ? ` por ${nombre[s.atendida_por] ?? '—'}` : ''} el ${fecha(diaLocal(s.atendida_at))}`
                              : ''}
                          </div>
                        </div>
                        {escribe && (
                          <button
                            type="button"
                            className={s.atendida ? 'btn-ghost text-xs shrink-0' : 'btn-primary text-xs py-1 shrink-0'}
                            disabled={ocupado === clave}
                            onClick={() => marcar(s, !s.atendida)}
                          >
                            {ocupado === clave ? 'Guardando…' : s.atendida ? 'Reabrir' : 'Atendida'}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
