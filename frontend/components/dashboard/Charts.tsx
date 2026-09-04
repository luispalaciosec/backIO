/** Gráficos SVG sin dependencias. */
export function Barras({ datos, color = '#0073EA', alto = 120, formato = (v: number) => String(v) }: { datos: { etiqueta: string; valor: number; secundario?: number }[]; color?: string; alto?: number; formato?: (v: number) => string }) {
  const max = Math.max(1, ...datos.map((d) => Math.max(d.valor, d.secundario ?? 0)));
  const w = 100 / Math.max(1, datos.length);
  return (
    <svg viewBox={`0 0 100 ${alto + 18}`} className="w-full" preserveAspectRatio="none" role="img">
      {datos.map((d, i) => {
        const h = (d.valor / max) * alto;
        const h2 = ((d.secundario ?? 0) / max) * alto;
        return (
          <g key={i}>
            {d.secundario !== undefined && <rect x={i * w + w * 0.15} y={alto - h2} width={w * 0.7} height={h2} fill="#E5E7EB" />}
            <rect x={i * w + w * 0.25} y={alto - h} width={w * 0.5} height={h} fill={color} rx={0.6}>
              <title>{d.etiqueta}: {formato(d.valor)}</title>
            </rect>
            <text x={i * w + w / 2} y={alto + 12} fontSize="4.2" textAnchor="middle" fill="#6B7280">{d.etiqueta}</text>
            {d.valor > 0 && <text x={i * w + w / 2} y={Math.max(6, alto - h - 2)} fontSize="4.2" textAnchor="middle" fill="#374151">{formato(d.valor)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

export function Kpi({ etiqueta, valor, sub, tono = 'neutral' }: { etiqueta: string; valor: number | string; sub?: string; tono?: 'neutral' | 'ok' | 'warn' | 'bad' }) {
  const color = { neutral: 'text-gray-900', ok: 'text-green-600', warn: 'text-amber-600', bad: 'text-red-600' }[tono];
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{etiqueta}</div>
      <div className={`text-3xl font-bold tabular-nums mt-1 ${color}`}>{valor}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

export function Semaforo({ salud }: { salud: 'verde' | 'amarillo' | 'rojo' }) {
  const c = { verde: '#00C875', amarillo: '#FDAB3D', rojo: '#E2445C' }[salud];
  return <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: c }} title={salud} />;
}
