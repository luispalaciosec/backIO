import type { EstadoOperativo } from '@backio/shared';
import { ESTADO_LABEL } from '@/lib/format';

const COLOR: Record<EstadoOperativo, string> = {
  backlog: 'bg-gray-200 text-gray-800',
  priorizado: 'bg-gray-300 text-gray-900',
  en_ejecucion: 'bg-[#0073EA] text-white',
  en_revision: 'bg-[#579BFC] text-white',
  reprogramado: 'bg-[#FDAB3D] text-white',
  bloqueado: 'bg-[#E2445C] text-white',
  completado: 'bg-[#0B7A3B] text-white',
  cancelado: 'bg-gray-400 text-white line-through',
};

export function EstadoChip({ estado }: { estado: EstadoOperativo }) {
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap ${COLOR[estado]}`}>{ESTADO_LABEL[estado]}</span>;
}

/** Chip de la vista cliente: solo 4 estados, nunca rojo. */
export function EstadoClienteChip({ estado, esperando }: { estado: 'pendiente' | 'en_proceso' | 'completado'; esperando?: boolean }) {
  if (esperando) return <span className="inline-block rounded px-2 py-0.5 text-xs font-medium text-white bg-estado-espera">Esperando tu aprobación</span>;
  const map = {
    completado: ['Completado', 'bg-estado-completado text-white'],
    en_proceso: ['En proceso', 'bg-estado-proceso text-white'],
    pendiente: ['Por iniciar', 'bg-estado-pendiente text-gray-800'],
  } as const;
  const [label, cls] = map[estado];
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}
