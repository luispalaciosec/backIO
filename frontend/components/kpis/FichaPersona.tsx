'use client';
/** KPIs de una persona (también «Mis KPIs» del colaborador). */
import type { KpiTablero } from '@backio/shared';
import { AREA_LABEL } from '@backio/shared';
import { ComoSeCalcula } from './ComoSeCalcula';
import { pct, COLOR_SUAVE, EstadoKpi, Origen, type Seleccion } from './comun';

export function FichaPersona({ tablero, usuarioId, onAbrir }: { tablero: KpiTablero; usuarioId: string; onAbrir: (s: Seleccion) => void }) {
  const area = tablero.areas.find((a) => a.kpis.some((k) => k.personas.some((p) => p.usuario_id === usuarioId)));
  if (!area) return <p className="text-sm text-gray-500">Todavía no hay un área asignada, así que no hay KPIs que mostrar. La asigna un administrador en Admin → Usuarios.</p>;
  const filas = area.kpis.map((k) => ({ k, p: k.personas.find((x) => x.usuario_id === usuarioId)! }));
  const cumple = filas.filter((f) => f.p.valor.estado === 'cumple').length;
  const conDato = filas.filter((f) => f.p.valor.estado !== 'sin_dato').length;
  return (
    <div className="space-y-3">
      <div className="text-sm text-gray-600">{AREA_LABEL[area.area]} · cumple <b>{cumple}</b> de <b>{conDato}</b> KPIs con dato</div>
      <div className="grid gap-3 md:grid-cols-2">
        {filas.map(({ k, p }) => (
          <button key={k.definicion.id} type="button" onClick={() => onAbrir({ kpi: k, usuarioId, nombre: p.nombre, valor: p.valor })} className={`text-left rounded-lg border p-3 hover:ring-2 hover:ring-brand/40 ${COLOR_SUAVE[p.valor.estado]}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-medium text-gray-900">{k.definicion.indicador}</div>
              <EstadoKpi v={p.valor} />
            </div>
            <div className="mt-2 flex items-end justify-between gap-2">
              <div>
                <div className="text-2xl font-bold tabular-nums text-gray-900">{pct(p.valor.resultado)}</div>
                <div className="text-xs text-gray-500">{p.valor.dato_a ?? '—'} de {p.valor.dato_b ?? '—'} · meta {k.definicion.operador === '>=' ? '≥' : '≤'} {pct(p.valor.meta)}</div>
              </div>
              <div className="text-right text-xs text-gray-500">Equipo<div className="font-semibold tabular-nums text-gray-700">{pct(k.equipo.resultado)}</div></div>
            </div>
            <div className="mt-1 flex gap-2 items-center text-[10px] text-gray-400">{k.definicion.codigo}<Origen v={p.valor} /></div>
          </button>
        ))}
      </div>
      <section className="pt-4 space-y-3">
        <div>
          <h3 className="text-lg font-bold">¿Cómo se calcula cada KPI?</h3>
          <p className="text-sm text-gray-500">Con tus números de este periodo: cada cuadrito es una tarea, y abajo ves cuánto te falta para la meta.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {filas.map(({ k, p }) => <ComoSeCalcula key={k.definicion.id} def={k.definicion} v={p.valor} equipo={k.equipo} />)}
        </div>
      </section>
    </div>
  );
}

/** Detalle de un KPI (equipo o persona): definición, tareas que lo componen y formulario de seguimiento. */
