import type { Cliente, Plantilla } from '@backio/shared';
import { fecha } from '@/lib/format';

export interface Borrador {
  id: string; cliente_id: string; prometio_cotizacion_id: string; plantilla_sugerida_id: string | null; created_at: string;
  payload: { numero?: string | null; valor?: number | null; valido_hasta?: string | null; empresa?: { nombre?: string }; lineas?: { servicio: string; cantidad: number }[] };
}

/** Cotizaciones aprobadas en PrometIO que esperan convertirse en proyecto (docs/08 · Flujo 1). */
export function Borradores({ items, clientes, plantillas, onUsar, onDescartar }: { items: Borrador[]; clientes: Cliente[]; plantillas: Plantilla[]; onUsar: (b: Borrador) => void; onDescartar: (id: string) => void }) {
  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
      <div>
        <div className="font-semibold text-amber-900">Cotizaciones ganadas en PrometIO ({items.length})</div>
        <div className="text-xs text-amber-800">Llegaron por webhook. Al usarlas, cliente, cotización y plantilla sugerida quedan prellenados; tú completas el brief y confirmas en el paso 5.</div>
      </div>
      <ul className="divide-y divide-amber-200">
        {items.map((b) => {
          const cliente = clientes.find((c) => c.id === b.cliente_id)?.nombre ?? b.payload.empresa?.nombre ?? 'Cliente';
          const plantilla = plantillas.find((p) => p.id === b.plantilla_sugerida_id)?.nombre;
          return (
            <li key={b.id} className="py-2 flex items-center justify-between gap-3 text-sm">
              <div>
                <div className="font-medium">{cliente} · {b.payload.numero ?? 'sin número'}{b.payload.valor ? ` · USD ${b.payload.valor}` : ''}</div>
                <div className="text-xs text-gray-600">{(b.payload.lineas ?? []).map((l) => `${l.servicio} ×${l.cantidad}`).join(', ') || 'sin líneas'} · válida hasta {fecha(b.payload.valido_hasta)} · {plantilla ? `plantilla sugerida: ${plantilla}` : 'sin plantilla sugerida'}</div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button className="btn-primary" onClick={() => onUsar(b)}>Usar</button>
                <button className="btn-ghost text-xs" onClick={() => { if (confirm('¿Descartar este borrador?')) onDescartar(b.id); }}>Descartar</button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
