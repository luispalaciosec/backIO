export function AvanceBar({ valor, color = '#0073EA', alto = 'h-3' }: { valor: number; color?: string; alto?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(valor)));
  return (
    <div className="flex items-center gap-3">
      <div className={`flex-1 ${alto} rounded-full bg-gray-200 overflow-hidden`} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full transition-all" style={{ width: `${v}%`, backgroundColor: color }} />
      </div>
      <span className="text-sm font-semibold tabular-nums w-10 text-right">{v}%</span>
    </div>
  );
}
