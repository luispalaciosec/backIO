/**
 * Contratos de la API REST (/api/v1). Payloads que viajan entre frontend y backend.
 */
import type { EstadoOperativo, Prioridad, Requerimiento, Proyecto, BriefProyecto } from './types';

export interface ApiError {
  error: string;
  detalle?: unknown;
}

export interface Paginado<T> {
  items: T[];
  total: number;
}

export interface CrearProyectoInput {
  cliente_id: string;
  plantilla_id: string;
  nombre: string;
  brief: Omit<BriefProyecto, 'version' | 'creado_at'>;
  fecha_entrega: string; // YYYY-MM-DD
  fecha_inicio?: string;
  prometio_cotizacion_id?: string | null;
  bloques: BloqueAlcanceInput[];
  owner_ejecutiva?: string | null;
}

export interface BloqueAlcanceInput {
  bloque_id: string;
  activo: boolean;
  owner_id: string | null;
  piezas_por_canal: Record<string, number>;
}

export interface CrearRequerimientoInput {
  cliente_id: string;
  proyecto_id?: string | null;
  titulo_interno: string;
  etiqueta_cliente?: string | null;
  bloque_nombre?: string | null;
  tipo_trabajo?: 'fee' | 'proyecto';
  prioridad?: Prioridad;
  peso?: number;
  fecha_pedido?: string | null;
  fecha_entrega?: string | null;
  owner_agencia?: string[];
  piezas?: number;
}

export type ActualizarRequerimientoInput = Partial<
  Pick<
    Requerimiento,
    | 'titulo_interno'
    | 'etiqueta_cliente'
    | 'visible_cliente'
    | 'estado_operativo'
    | 'estado_aprobacion'
    | 'prioridad'
    | 'peso'
    | 'fecha_entrega'
    | 'owner_agencia'
    | 'owner_cliente'
    | 'piezas'
    | 'brief_url'
    | 'entregable_urls'
  >
>;

export interface ProyectoDetalle extends Proyecto {
  cliente_nombre: string;
  requerimientos: Requerimiento[];
  avance: number; // ponderado interno (sobre todas las tareas)
}

export interface FilaImportCSV {
  cliente_slug: string;
  proyecto: string;
  titulo_interno: string;
  etiqueta_cliente: string;
  visible: string;
  bloque: string;
  peso: string;
  tipo: string;
  prioridad: string;
  fecha_pedido: string;
  fecha_entrega: string;
  owner_email: string;
  piezas: string;
}

export interface PreviewImport {
  validas: (FilaImportCSV & { fila: number })[];
  rechazadas: { fila: number; motivo: string; datos: FilaImportCSV }[];
}

export interface ResumenClientePrometio {
  cliente_id: string;
  proyectos_activos: number;
  proyectos: { nombre: string; avance: number; entrega: string; estado: EstadoOperativo }[];
  requerimientos_atrasados: number;
  dias_sin_movimiento: number;
  esperando_cliente: number;
}

export interface CapacidadPersona {
  usuario_id: string;
  nombre: string;
  capacidad_semanal: number;
  tareas: number;
  pct_del_total: number;
}

export interface DailyView {
  vencen_hoy_o_manana_sin_iniciar: Requerimiento[];
  bloqueos_nuevos: Requerimiento[];
  fechas_cambiadas: Requerimiento[];
}
