'use client';
/** Gráficas SVG del informe por canal: réplica del tablero de Monday. Sin librerías; imprimen bien. */
export interface Serie { id: string; nombre: string; color: string }

export function Tarjeta({ titulo, children, className = '' }: { titulo: string; children: React.ReactNode; className?: string }) {
  return <section className={`rounded-md border border-gray-200 bg-white ${className}`}><div className="px-4 py-2.5 border-b border-gray-200 font-semibold text-[15px] text-gray-800">{titulo}</div><div className="p-4">{children}</div></section>;
}

export function Leyenda({ series }: { series: Serie[] }) {
  return <div className="flex flex-wrap justify-center gap-4 mt-2 text-[11px] font-semibold text-gray-700">{series.map((s) => <span key={s.id} className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.nombre}</span>)}</div>;
}

function escalaMax(v: number) { if (v <= 0) return 10; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = Math.ceil(v / p * 2) / 2 * p; return n === v ? n + p / 2 : n; }

/** Barras dobles por mes (piezas azul, recuento amarillo) con etiquetas de valor. */
export function BarrasDobles({ datos, a, b }: { datos: { etiqueta: string; a: number; b: number }[]; a: Serie; b: Serie }) {
  const W = 960, H = 170, pad = { l: 40, r: 10, t: 24, b: 30 };
  const max = escalaMax(Math.max(1, ...datos.map((d) => Math.max(d.a, d.b))));
  const iw = (W - pad.l - pad.r) / Math.max(datos.length, 1); const bw = Math.min(46, iw * 0.28);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  return (
    <div><svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {[0, 0.5, 1].map((f) => <g key={f}><line x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="#eef0f3" /><text x={pad.l - 6} y={y(max * f) + 4} textAnchor="end" fontSize="10" fill="#6b7280">{Math.round(max * f)}</text></g>)}
      {datos.map((d, i) => { const cx = pad.l + iw * i + iw / 2; return (<g key={d.etiqueta}>
        <rect x={cx - bw - 4} y={y(d.a)} width={bw} height={y(0) - y(d.a)} fill={a.color} rx={3} /><text x={cx - 4 - bw / 2} y={y(d.a) - 5} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1f2937">{d.a}</text>
        <rect x={cx + 4} y={y(d.b)} width={bw} height={y(0) - y(d.b)} fill={b.color} rx={3} /><text x={cx + 4 + bw / 2} y={y(d.b) - 5} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1f2937">{d.b}</text>
        <text x={cx} y={H - 10} textAnchor="middle" fontSize="11" fill="#374151">{d.etiqueta}</text></g>); })}
    </svg><Leyenda series={[a, b]} /></div>
  );
}

/** Líneas por semana. */
export function Lineas({ datos, a, b }: { datos: { etiqueta: string; a: number; b: number }[]; a: Serie; b: Serie }) {
  const W = 960, H = 190, pad = { l: 40, r: 14, t: 16, b: 58 };
  const max = escalaMax(Math.max(1, ...datos.map((d) => Math.max(d.a, d.b))));
  const n = Math.max(datos.length, 1); const x = (i: number) => pad.l + (W - pad.l - pad.r) * (n === 1 ? 0.5 : i / (n - 1)); const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const path = (k: 'a' | 'b') => datos.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d[k])}`).join(' ');
  return (
    <div><svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {[0, 0.5, 1].map((f) => <g key={f}><line x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="#eef0f3" /><text x={pad.l - 6} y={y(max * f) + 4} textAnchor="end" fontSize="10" fill="#6b7280">{Math.round(max * f)}</text></g>)}
      <path d={path('a')} fill="none" stroke={a.color} strokeWidth="2" /><path d={path('b')} fill="none" stroke={b.color} strokeWidth="2" />
      {datos.map((d, i) => <g key={d.etiqueta}><circle cx={x(i)} cy={y(d.a)} r="2.5" fill={a.color} /><circle cx={x(i)} cy={y(d.b)} r="2.5" fill={b.color} /><text transform={`translate(${x(i)},${H - 44}) rotate(-45)`} textAnchor="end" fontSize="9.5" fill="#374151">{d.etiqueta}</text></g>)}
    </svg><Leyenda series={[a, b]} /></div>
  );
}

/** Barras apiladas por mes y canal; modo 'valor' o 'pct'. */
export function Apiladas({ datos, series, modo, ejeY }: { datos: { etiqueta: string; total: number; valores: Record<string, number> }[]; series: Serie[]; modo: 'valor' | 'pct'; ejeY: string }) {
  const W = 420, H = 430, pad = { l: 44, r: 8, t: 22, b: 78 };
  const max = modo === 'pct' ? 100 : escalaMax(Math.max(1, ...datos.map((d) => d.total)));
  const iw = (W - pad.l - pad.r) / Math.max(datos.length, 1); const bw = Math.min(40, iw * 0.55);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const ticks = modo === 'pct' ? [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] : Array.from({ length: 11 }, (_, i) => Math.round(max * i / 10));
  return (
    <div><svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      <text transform={`translate(12,${(H - pad.b + pad.t) / 2}) rotate(-90)`} textAnchor="middle" fontSize="10" fill="#6b7280">{ejeY}</text>
      {ticks.map((t) => <g key={t}><line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#eef0f3" /><text x={pad.l - 6} y={y(t) + 3.5} textAnchor="end" fontSize="9.5" fill="#6b7280">{t}</text></g>)}
      {datos.map((d, i) => { const cx = pad.l + iw * i + iw / 2; let acc = 0; const tot = d.total || 1; return (<g key={d.etiqueta}>
        {series.map((s) => { const v = d.valores[s.id] ?? 0; const h = modo === 'pct' ? (v / tot) * 100 : v; const y0 = y(acc + h), y1 = y(acc); acc += h; if (!v) return null; const alto = y1 - y0; return (<g key={s.id}><rect x={cx - bw / 2} y={y0} width={bw} height={alto} fill={s.color} />{alto > 11 && <text x={cx} y={y0 + alto / 2 + 3.5} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#fff">{modo === 'pct' ? `${(v / tot * 100).toFixed(1)}%` : v}</text>}</g>); })}
        {d.total > 0 && <text x={cx} y={y(modo === 'pct' ? 100 : d.total) - 4} textAnchor="middle" fontSize="10" fontWeight="700" fill="#1f2937">{d.total}</text>}
        <text transform={`translate(${cx},${H - 64}) rotate(-45)`} textAnchor="end" fontSize="9.5" fill="#374151">{d.etiqueta}</text></g>); })}
    </svg><Leyenda series={series} /></div>
  );
}

/** Pastel o dona con leyenda a la derecha. */
export function Pastel({ partes, dona = false }: { partes: { nombre: string; valor: number; color: string }[]; dona?: boolean }) {
  const total = partes.reduce((s, p) => s + p.valor, 0) || 1; let ang = -Math.PI / 2; const R = 44, cx = 50, cy = 50;
  const arcos = partes.filter((p) => p.valor > 0).map((p) => { const a0 = ang; const a1 = ang + (p.valor / total) * 2 * Math.PI; ang = a1; const large = a1 - a0 > Math.PI ? 1 : 0; const x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0), x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1); return { ...p, d: partes.filter((q) => q.valor > 0).length === 1 ? `M${cx - R},${cy} a${R},${R} 0 1,0 ${2 * R},0 a${R},${R} 0 1,0 ${-2 * R},0` : `M${cx},${cy} L${x0},${y0} A${R},${R} 0 ${large},1 ${x1},${y1} Z` }; });
  return (
    <div className="flex items-center gap-4"><svg viewBox="0 0 100 100" className="w-28 h-28 shrink-0">{arcos.map((a) => <path key={a.nombre} d={a.d} fill={a.color} />)}{dona && <circle cx={cx} cy={cy} r={R * 0.55} fill="#fff" />}</svg>
      <ul className="text-[11px] space-y-1.5 text-gray-700">{partes.map((p) => <li key={p.nombre} className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />{p.nombre}: {(p.valor / total * 100).toFixed(1)}%</li>)}</ul></div>
  );
}

/** Barra de estado general (aprobado / en revisión) con % listo. */
export function BarraEstado({ aprobado, revision, pctListo }: { aprobado: number; revision: number; pctListo: number }) {
  const t = aprobado + revision || 1;
  return (
    <div><div className="flex items-center gap-3"><div className="flex-1 h-14 rounded-sm overflow-hidden flex border border-gray-200" style={{ background: '#e5e7eb' }}><div style={{ width: `${(aprobado / t) * 100}%`, background: '#0b7a3b' }} /><div style={{ width: `${(revision / t) * 100}%`, background: '#7e3fbf' }} /></div><div className="text-sm font-semibold text-gray-700 whitespace-nowrap">{pctListo}% Listo</div></div>
      <Leyenda series={[{ id: 'a', nombre: 'Aprobado', color: '#0b7a3b' }, { id: 'r', nombre: 'En revisión cliente', color: '#7e3fbf' }]} /></div>
  );
}
