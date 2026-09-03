/**
 * ============================================================================
 *  ZONA DE REVISIÓN HUMANA OBLIGATORIA  (CLAUDE.md · docs/02-visibilidad.md)
 * ============================================================================
 *
 * ÚNICO punto de salida de datos hacia el cliente. No existe otro.
 *
 * - El portal público, el endpoint /api/portal/:token, las tools MCP con scope
 *   cliente y el preview del paso 5 del Builder usan ESTA función. Nunca una
 *   copia "para preview".
 * - Nunca expone titulo_interno, owner_agencia, peso, prioridad, basecamp_*,
 *   estado_operativo crudo ni notas internas.
 * - Los estados internos se colapsan: el cliente no ve "atrasado" ni "bloqueado".
 * - El avance se renormaliza sobre los requerimientos visibles.
 */

import type { EstadoAprobacion, EstadoOperativo } from '../types';

export type EstadoCliente = 'pendiente' | 'en_proceso' | 'completado';

export interface ClientSafeRequirement {
  id: string;
  titulo: string; // etiqueta_cliente, NUNCA titulo_interno
  estado: EstadoCliente;
  fecha_estimada: string | null;
  esperando_cliente: boolean;
}

export interface ClientSafeProject {
  nombre: string;
  avance: number; // ponderado y RENORMALIZADO sobre visibles
  fecha_entrega: string;
  hitos: ClientSafeRequirement[];
  bloqueado_por_cliente: { titulo: string; dias: number }[];
}

/** Subconjunto mínimo que la función necesita. Evita que el llamador pase el objeto entero por accidente. */
export interface SanitizableProject {
  nombre: string;
  fecha_entrega: string;
}

export interface SanitizableRequirement {
  id: string;
  etiqueta_cliente: string | null;
  visible_cliente: boolean;
  peso: number;
  estado_operativo: EstadoOperativo;
  estado_aprobacion: EstadoAprobacion;
  fecha_entrega: string | null;
  ultima_actualizacion: string;
}

export function mapEstadoCliente(estado: EstadoOperativo): EstadoCliente {
  switch (estado) {
    case 'completado':
      return 'completado';
    case 'backlog':
    case 'priorizado':
      return 'pendiente';
    // reprogramado, bloqueado, en_revision, en_ejecucion, cancelado → en_proceso.
    // El cliente no ve la palabra "atrasado" ni "bloqueado por nosotros".
    default:
      return 'en_proceso';
  }
}

export function diasDesde(iso: string, ahora: Date = new Date()): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((ahora.getTime() - t) / 86_400_000));
}

export function sanitizeForClient(
  p: SanitizableProject,
  reqs: SanitizableRequirement[],
  ahora: Date = new Date(),
): ClientSafeProject {
  // Doble filtro: visible_cliente === true Y etiqueta_cliente presente.
  // El constraint SQL ya lo garantiza, pero esta función no confía en nadie.
  const visibles = reqs.filter(
    (r) => r.visible_cliente === true && typeof r.etiqueta_cliente === 'string' && r.etiqueta_cliente.length > 0,
  );

  const pesoTotal = visibles.reduce((s, r) => s + Number(r.peso), 0);
  const pesoHecho = visibles
    .filter((r) => r.estado_operativo === 'completado')
    .reduce((s, r) => s + Number(r.peso), 0);

  const esperando = visibles.filter((r) => r.estado_aprobacion === 'pendiente_cliente');

  return {
    nombre: p.nombre,
    avance: pesoTotal === 0 ? 0 : Math.round((pesoHecho / pesoTotal) * 100),
    fecha_entrega: p.fecha_entrega,
    hitos: visibles.map((r) => ({
      id: r.id,
      titulo: r.etiqueta_cliente as string,
      estado: mapEstadoCliente(r.estado_operativo),
      fecha_estimada: r.fecha_entrega,
      esperando_cliente: r.estado_aprobacion === 'pendiente_cliente',
    })),
    bloqueado_por_cliente: esperando.map((r) => ({
      titulo: r.etiqueta_cliente as string,
      dias: diasDesde(r.ultima_actualizacion, ahora),
    })),
  };
}

/** Campos que JAMÁS pueden aparecer en un payload servido al cliente. Usado en tests y en el middleware del portal. */
export const CAMPOS_PROHIBIDOS_CLIENTE: readonly string[] = [
  'titulo_interno',
  'owner_agencia',
  'owner_ejecutiva',
  'basecamp',
  'peso',
  'prioridad',
  'estado_operativo',
  'estado_aprobacion',
  'veces_reprogramado',
  'dias_atraso',
  'notas_cuenta',
  'tenant_id',
];

export function assertClientSafe(payload: unknown): void {
  const dump = JSON.stringify(payload);
  for (const campo of CAMPOS_PROHIBIDOS_CLIENTE) {
    if (dump.includes(`"${campo}`)) {
      throw new Error(`Payload cliente contiene campo prohibido: ${campo}`);
    }
  }
}
