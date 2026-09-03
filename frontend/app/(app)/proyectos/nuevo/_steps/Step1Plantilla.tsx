import type { Plantilla } from '@backio/shared';

const DESCRIPCION: Record<string, string> = {
  campana: 'Campaña con múltiples canales',
  lanzamiento: 'Producto o servicio nuevo',
  fee_mensual: 'Contenido recurrente',
  pieza_suelta: 'Requerimiento aislado',
  trade: 'Material POP, cadenas',
};

export function Step1Plantilla({ plantillas, onSelect, seleccionada }: { plantillas: Plantilla[]; onSelect: (id: string) => void; seleccionada: string | null }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {plantillas.length === 0 && <div className="text-gray-500">Cargando plantillas…</div>}
      {plantillas.map((p) => (
        <button
          key={p.id}
          onClick={() => onSelect(p.id)}
          className={`card p-5 text-left hover:border-brand transition ${seleccionada === p.id ? 'border-brand ring-2 ring-brand/30' : ''}`}
        >
          <div className="text-xs uppercase tracking-wide text-gray-500">{DESCRIPCION[p.tipo] ?? p.tipo}</div>
          <div className="text-lg font-semibold mt-1">{p.nombre}</div>
          <p className="text-sm text-gray-600 mt-2">{p.descripcion}</p>
        </button>
      ))}
    </div>
  );
}
