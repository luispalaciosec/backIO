import type { Plantilla, PlantillaArbol, Cliente, Usuario, BloqueAlcanceInput, CrearProyectoInput } from '@backio/shared';

export interface WizardState {
  paso: 1 | 2 | 3 | 4 | 5;
  plantilla: PlantillaArbol | null;
  cliente_id: string;
  nombre: string;
  brief: CrearProyectoInput['brief'];
  fecha_entrega: string;
  prometio_cotizacion_id: string | null;
  bloques: Record<string, BloqueAlcanceInput>; // por bloque_id
  /** Piezas por tipo detectadas por la IA en el brief pegado (solo un recordatorio para el paso 3). */
  piezas_sugeridas?: Record<string, number>;
}

export const ESTADO_INICIAL: WizardState = {
  paso: 1,
  plantilla: null,
  cliente_id: '',
  nombre: '',
  brief: { objetivo_negocio: '', publico_objetivo: '', canales: [], mandatorios_marca: '', presupuesto_aprobado: null },
  fecha_entrega: '',
  prometio_cotizacion_id: null,
  bloques: {},
};

export interface Catalogo {
  plantillas: Plantilla[];
  clientes: Cliente[];
  usuarios: Usuario[];
}

export function toInput(s: WizardState): CrearProyectoInput {
  return {
    cliente_id: s.cliente_id,
    plantilla_id: s.plantilla!.id,
    nombre: s.nombre,
    brief: s.brief,
    fecha_entrega: s.fecha_entrega,
    prometio_cotizacion_id: s.prometio_cotizacion_id,
    bloques: Object.values(s.bloques),
  };
}

/** Borrador de UI (no negocio) en sessionStorage, permitido por CLAUDE.md como borrador. */
const KEY = 'backio:builder:borrador';
export function guardarBorrador(s: WizardState) {
  try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
export function leerBorrador(): WizardState | null {
  try { const raw = sessionStorage.getItem(KEY); return raw ? (JSON.parse(raw) as WizardState) : null; } catch { return null; }
}
export function limpiarBorrador() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
