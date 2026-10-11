'use client';
/** Tablero del equipo: KPIs por área con el valor de cada persona. */
import type { KpiTablero } from '@backio/shared';
import { AREA_LABEL } from '@backio/shared';
import { pct, COLOR_SUAVE, Origen, Tendencia, Avatar, type Seleccion } from './comun';

export function VistaEquipo({
  tablero,
  onAbrir,
  onPersona,
}: {
  tablero: KpiTablero;
  onAbrir: (s: Seleccion) => void;
  onPersona: (id: string) => void;
}) {
  return (
    <div className="space-y-6">
      {tablero.areas
        .filter((a) => a.kpis.length)
        .map((a) => (
          <section key={a.area} className="card overflow-hidden">
            <header className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between gap-3 flex-wrap">
              <div className="font-semibold">
                {AREA_LABEL[a.area]}{' '}
                <span className="text-gray-400 font-normal text-sm">
                  · {a.integrantes} {a.integrantes === 1 ? 'persona' : 'personas'}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {a.kpis[0]?.personas.map((p) => (
                  <button
                    key={p.usuario_id}
                    type="button"
                    onClick={() => onPersona(p.usuario_id)}
                    className="hover:ring-2 hover:ring-brand rounded-full"
                  >
                    <Avatar nombre={p.nombre} url={p.avatar_url} size={26} />
                  </button>
                ))}
              </div>
            </header>
            {a.integrantes === 0 && (
              <p className="px-4 py-3 text-sm text-amber-700">
                Nadie tiene asignada esta área. Asígnala en Admin → Usuarios para que se calculen sus KPIs.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500">
                    <th className="th w-[34%]">Indicador</th>
                    <th className="th text-center">Meta</th>
                    <th className="th text-center">Equipo</th>
                    <th className="th text-center">Tendencia</th>
                    {a.kpis[0]?.personas.map((p) => (
                      <th key={p.usuario_id} className="th text-center font-normal whitespace-nowrap" title={p.nombre}>
                        {p.nombre.split(' ')[0]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {a.kpis.map((k) => (
                    <tr key={k.definicion.id} className="border-t border-gray-100">
                      <td className="td">
                        <div className="font-medium">{k.definicion.indicador}</div>
                        <div className="text-xs text-gray-400 flex gap-2 items-center">
                          <span>{k.definicion.codigo}</span>
                          <span>· {k.definicion.periodicidad}</span>
                          <Origen v={k.equipo} />
                        </div>
                      </td>
                      <td className="td text-center tabular-nums text-gray-600 whitespace-nowrap">
                        {k.definicion.operador === '>=' ? '≥' : '≤'} {pct(k.definicion.meta)}
                      </td>
                      <td className="td text-center">
                        <button
                          type="button"
                          onClick={() => onAbrir({ kpi: k, usuarioId: null, nombre: `Equipo ${AREA_LABEL[a.area]}`, valor: k.equipo })}
                          className={`rounded-md border px-2 py-1 tabular-nums font-semibold hover:ring-2 hover:ring-brand/40 ${COLOR_SUAVE[k.equipo.estado]}`}
                          title={`${k.equipo.dato_a ?? '—'} / ${k.equipo.dato_b ?? '—'}`}
                        >
                          {pct(k.equipo.resultado)}
                        </button>
                      </td>
                      <td className="td text-center">
                        <Tendencia serie={k.serie} />
                      </td>
                      {k.personas.map((p) => (
                        <td key={p.usuario_id} className="td text-center">
                          <button
                            type="button"
                            onClick={() => onAbrir({ kpi: k, usuarioId: p.usuario_id, nombre: p.nombre, valor: p.valor })}
                            className={`rounded px-1.5 py-0.5 text-xs tabular-nums border hover:ring-2 hover:ring-brand/40 ${COLOR_SUAVE[p.valor.estado]}`}
                            title={`${p.nombre}: ${p.valor.dato_a ?? '—'} / ${p.valor.dato_b ?? '—'}${p.valor.origen === 'ajustado' ? ' · ajustado' : ''}`}
                          >
                            {p.valor.estado === 'sin_dato' ? '—' : pct(p.valor.resultado)}
                          </button>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
    </div>
  );
}

/** Ficha de una persona: todos los KPIs de su área, su valor vs meta y el del equipo. */
