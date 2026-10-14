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

export function sanitizeForClient(p: SanitizableProject, reqs: SanitizableRequirement[], ahora: Date = new Date()): ClientSafeProject {
  // Doble filtro: visible_cliente === true Y etiqueta_cliente presente.
  // El constraint SQL ya lo garantiza, pero esta función no confía en nadie.
  const visibles = reqs.filter(
    (r) => r.visible_cliente === true && typeof r.etiqueta_cliente === 'string' && r.etiqueta_cliente.length > 0,
  );

  // El avance no cuenta las canceladas (decisión de Luis, 11/10/2026). En la lista siguen apareciendo como
  // «En proceso» (decisión del 04/09/2026).
  const cuentan = visibles.filter((r) => r.estado_operativo !== 'cancelado');
  const pesoTotal = cuentan.reduce((s, r) => s + Number(r.peso), 0);
  const pesoHecho = cuentan.filter((r) => r.estado_operativo === 'completado').reduce((s, r) => s + Number(r.peso), 0);

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
  // Revisa los NOMBRES de los campos, a cualquier profundidad (un campo que empiece por «basecamp» también cae).
  // Antes buscaba el texto en todo el JSON, valores incluidos: un hito llamado «peso ideal» tumbaba el portal con un
  // 500 (escaneo del 13/10/2026). El JSON intermedio es el mismo que se envía (respeta toJSON).
  const revisar = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(revisar);
    if (v === null || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      const campo = CAMPOS_PROHIBIDOS_CLIENTE.find((c) => k.startsWith(c));
      if (campo) throw new Error(`Payload cliente contiene campo prohibido: ${campo}`);
      revisar(x);
    }
  };
  revisar(JSON.parse(JSON.stringify(payload ?? null)));
}
