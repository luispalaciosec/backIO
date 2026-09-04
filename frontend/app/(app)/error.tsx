'use client';
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="max-w-xl mx-auto mt-16 card p-6 space-y-3">
      <div className="text-lg font-semibold">No se pudo cargar esta pantalla</div>
      <p className="text-sm text-gray-600">{error.message || 'Error inesperado.'}</p>
      {error.digest && <p className="text-xs text-gray-400">Ref: {error.digest}</p>}
      <button className="btn-primary" onClick={reset}>Reintentar</button>
    </div>
  );
}
