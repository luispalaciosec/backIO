export function Alert({ tipo = 'info', children }: { tipo?: 'info' | 'warn' | 'error' | 'ok'; children: React.ReactNode }) {
  const cls = {
    info: 'bg-blue-50 border-blue-200 text-blue-900',
    warn: 'bg-amber-50 border-amber-200 text-amber-900',
    error: 'bg-red-50 border-red-200 text-red-900',
    ok: 'bg-green-50 border-green-200 text-green-900',
  }[tipo];
  return <div className={`rounded-md border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}
