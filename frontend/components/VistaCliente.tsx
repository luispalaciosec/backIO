/**
 * Render de ClientSafeProject. Se usa en el portal público, en el paso 5 del Builder
 * y en el detalle de proyecto. Solo recibe el payload sanitizado: no puede mostrar nada más.
 */
import type { ClientSafeProject } from '@backio/shared';
import { AvanceBar } from '@/components/ui/AvanceBar';
import { EstadoClienteChip } from '@/components/ui/EstadoChip';
import { fechaLarga } from '@/lib/format';

export function VistaCliente({
  data,
  clienteNombre,
  logoUrl,
  color = '#0073EA',
  children,
}: {
  data: ClientSafeProject;
  clienteNombre: string;
  logoUrl?: string | null;
  color?: string;
  children?: React.ReactNode;
}) {
  const icono = { completado: '✓', en_proceso: '◐', pendiente: '○' } as const;
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-200 flex items-center gap-3">
        {logoUrl ? <img src={logoUrl} alt={clienteNombre} className="h-8 w-auto" /> : <div className="h-8 w-8 rounded bg-gray-200" />}
        <div className="min-w-0">
          <div className="font-semibold truncate">{data.nombre}</div>
          <div className="text-xs text-gray-500">Geeks · Entrega {fechaLarga(data.fecha_entrega)}</div>
        </div>
      </div>
      <div className="px-5 py-4 space-y-1">
        <AvanceBar valor={data.avance} color={color} />
        <div className="text-xs text-gray-500">Avance del proyecto</div>
      </div>
      {data.bloqueado_por_cliente.length > 0 && (
        <div className="mx-5 mb-4 rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm">
          <div className="font-semibold text-amber-900">⚠ Esperando tu aprobación</div>
          {data.bloqueado_por_cliente.map((b, i) => (
            <div key={i} className="text-amber-900">{b.titulo} · {b.dias} {b.dias === 1 ? 'día' : 'días'}</div>
          ))}
        </div>
      )}
      <div className="px-5 pb-4">
        <div className="label">Hitos</div>
        {data.hitos.length === 0 && <div className="text-sm text-gray-500">Sin hitos visibles todavía.</div>}
        <ul className="divide-y divide-gray-100">
          {data.hitos.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="flex items-center gap-2"><span className="text-gray-400 w-4">{icono[h.estado]}</span>{h.titulo}</span>
              <EstadoClienteChip estado={h.estado} esperando={h.esperando_cliente} />
            </li>
          ))}
        </ul>
      </div>
      {children}
    </div>
  );
}
