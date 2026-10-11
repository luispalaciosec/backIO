'use client';
/** Piezas comunes del tablero de KPIs: colores por estado, formato de mes, avatar, tendencia. */
import type { KpiTablero, KpiValor } from '@backio/shared';
import { formatoFraccion } from '@backio/shared';
import { iniciales } from '@/lib/format';

export type Kpi = KpiTablero['areas'][number]['kpis'][number];

export const pct = formatoFraccion;
export const COLOR: Record<KpiValor['estado'], string> = {
  cumple: 'bg-emerald-600 text-white',
  no_cumple: 'bg-red-600 text-white',
  sin_dato: 'bg-gray-100 text-gray-400',
};
export const COLOR_SUAVE: Record<KpiValor['estado'], string> = {
  cumple: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  no_cumple: 'bg-red-50 text-red-800 border-red-200',
  sin_dato: 'bg-gray-50 text-gray-400 border-gray-200',
};
export const ETIQUETA: Record<KpiValor['estado'], string> = { cumple: 'Cumple', no_cumple: 'No cumple', sin_dato: 'Sin dato' };

export function mesActual(): string {
  const d = new Date(Date.now() - 5 * 3600_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
export function moverMes(mes: string, n: number): string {
  const d = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
export const nombreMes = (mes: string) =>
  new Intl.DateTimeFormat('es-EC', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${mes}-15T12:00:00Z`));

export function EstadoKpi({ v, grande = false }: { v: KpiValor; grande?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 ${grande ? 'py-0.5 text-xs' : 'text-[10px]'} font-semibold ${COLOR[v.estado]}`}
    >
      {ETIQUETA[v.estado]}
    </span>
  );
}

export function Origen({ v }: { v: KpiValor }) {
  if (v.origen === 'ajustado')
    return (
      <span className="text-[10px] rounded bg-amber-100 text-amber-800 px-1.5" title={v.medicion?.justificacion_ajuste ?? ''}>
        ajustado
      </span>
    );
  if (v.origen === 'manual') return <span className="text-[10px] rounded bg-violet-100 text-violet-800 px-1.5">manual</span>;
  if (v.origen === 'auto')
    return (
      <span
        className="text-[10px] rounded bg-sky-100 text-sky-800 px-1.5"
        title={v.estimado ? 'Estimado con datos anteriores a las rondas de revisión' : 'Calculado por BackIO'}
      >
        {v.estimado ? 'estimado' : 'automático'}
      </span>
    );
  return null;
}

export function Tendencia({ serie }: { serie: Kpi['serie'] }) {
  const puntos = serie.map((s) => s.resultado);
  const max = Math.max(1, ...puntos.map((p) => p ?? 0));
  const w = 84,
    h = 22,
    paso = serie.length > 1 ? w / (serie.length - 1) : w;
  const xy = serie.map((s, i) => (s.resultado === null ? null : ([i * paso, h - 2 - (s.resultado / max) * (h - 4)] as const)));
  const linea = xy
    .filter(Boolean)
    .map((p) => `${p![0].toFixed(1)},${p![1].toFixed(1)}`)
    .join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible" aria-label="Tendencia">
      {linea && <polyline points={linea} fill="none" stroke="#94a3b8" strokeWidth={1.5} />}
      {xy.map(
        (p, i) =>
          p && (
            <circle
              key={i}
              cx={p[0]}
              cy={p[1]}
              r={i === serie.length - 1 ? 3 : 2}
              fill={serie[i]!.estado === 'cumple' ? '#059669' : serie[i]!.estado === 'no_cumple' ? '#dc2626' : '#cbd5e1'}
            >
              <title>{`${serie[i]!.periodo}: ${pct(serie[i]!.resultado)}`}</title>
            </circle>
          ),
      )}
    </svg>
  );
}

export function Avatar({ nombre, url, size = 28 }: { nombre: string; url: string | null; size?: number }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={nombre}
      title={nombre}
      width={size}
      height={size}
      className="rounded-full object-cover border border-gray-200"
      referrerPolicy="no-referrer"
    />
  ) : (
    <span
      title={nombre}
      className="rounded-full bg-brand/10 text-brand font-bold inline-flex items-center justify-center"
      style={{ width: size, height: size, fontSize: size / 2.6 }}
    >
      {iniciales(nombre)}
    </span>
  );
}

export interface Seleccion {
  kpi: Kpi;
  usuarioId: string | null;
  nombre: string;
  valor: KpiValor;
}

/** Vista por equipo: por área, cada KPI con valor del equipo y la matriz de integrantes. */
