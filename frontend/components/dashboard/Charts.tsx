/** Gráficos SVG sin dependencias. Altura fija; el ancho se adapta a la tarjeta. */
export function Barras({ datos, color = '#0073EA', formato = (v: number) => String(v) }: { datos: { etiqueta: string; valor: number; secundario?: number }[]; color?: string; formato?: (v: number) => string }) {
  const W = 480, H = 150, padTop = 16, padBottom = 22;
  const areaH = H - padTop - padBottom;
  const max = Math.max(1, ...datos.map((d) => Math.max(d.valor, d.secundario ?? 0)));
  const w = W / Math.max(1, datos.length);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-44" preserveAspectRatio="xMidYMid meet" role="img">
      <line x1={0} x2={W} y1={padTop + areaH} y2={padTop + areaH} stroke="#E5E7EB" strokeWidth={1} />
      {datos.map((d, i) => {
        const h = (d.valor / max) * areaH;
        const h2 = ((d.secundario ?? 0) / max) * areaH;
        const x = i * w;
        return (
          <g key={i}>
            {d.secundario !== undefined && d.secundario > 0 && <rect x={x + w * 0.2} y={padTop + areaH - h2} width={w * 0.6} height={h2} fill="#E5E7EB" rx={3} />}
            {d.valor > 0 && (
              <rect x={x + w * 0.3} y={padTop + areaH - h} width={w * 0.4} height={h} fill={color} rx={3}>
                <title>{d.etiqueta}: {formato(d.valor)}</title>
              </rect>
            )}
            {d.valor > 0 && <text x={x + w / 2} y={padTop + areaH - h - 4} fontSize="11" fontWeight="600" textAnchor="middle" fill="#374151">{formato(d.valor)}</text>}
            <text x={x + w / 2} y={H - 6} fontSize="10" textAnchor="middle" fill="#6B7280">{d.etiqueta}</text>
          </g>
        );
      })}
      {datos.every((d) => d.valor === 0) && <text x={W / 2} y={padTop + areaH / 2} fontSize="12" textAnchor="middle" fill="#9CA3AF">Sin datos en el período</text>}
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
