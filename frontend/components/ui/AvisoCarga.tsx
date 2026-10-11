'use client';
import { Alert } from './Alert';

/** Aviso de cargas secundarias que fallaron (ver useAvisosCarga). No se muestra si todo cargó. */
export function AvisoCarga({ fallos }: { fallos: Record<string, string> }) {
  const que = Object.keys(fallos);
  if (!que.length) return null;
  const motivos = [...new Set(Object.values(fallos))];
  return (
    <Alert tipo="warn">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          No se pudo cargar {que.join(', ')}. Lo que depende de eso puede verse incompleto
          {motivos.length === 1 ? ` (${motivos[0]})` : ''}.
        </span>
        <button type="button" className="btn-ghost text-xs" onClick={() => window.location.reload()}>
          Reintentar
        </button>
      </div>
    </Alert>
  );
}
