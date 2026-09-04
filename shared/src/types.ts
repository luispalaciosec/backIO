/**
 * Tipos de dominio compartidos entre backend y frontend.
 * Nombres de columnas en snake_case español (espejo del esquema SQL).
 */

export type EstadoOperativo =
  | 'backlog'
  | 'priorizado'
  | 'en_ejecucion'
  | 'en_revision'
  | 'reprogramado'
  | 'bloqueado'
  | 'completado'
  | 'cancelado';

export type EstadoAprobacion =
  | 'no_aplica'
  | 'pendiente_interno'
  | 'pendiente_cliente'
  | 'aprobado'
  | 'rechazado';

export type Prioridad = 'alta' | 'media' | 'baja';

export type Rol = 'admin' | 'gerencia' | 'operaciones' | 'ejecutiva' | 'lider' | 'colaborador';

export const ROLES_INTERNOS_GESTION: readonly Rol[] = [
  'admin',
  'gerencia',
  'operaciones',
  'ejecutiva',
  'lider',
];

export type TipoPlantilla = 'campana' | 'lanzamiento' | 'fee_mensual' | 'pieza_suelta' | 'trade';

export type TipoTrabajo = 'fee' | 'proyecto';

export type SyncEstado = 'pendiente' | 'ok' | 'incompleto';

export interface Tenant {
  id: string;
  nombre: string;
  slug: string;
  config: Record<string, unknown>;
  activo: boolean;
}

export interface Mesa {
  id: string;
  tenant_id: string;
  nombre: string;
  slug: string;
  basecamp_project_id: number | null;
  basecamp_board_daily_id: number | null;
  basecamp_board_weekly_id: number | null;
  lider_id: string | null;
  color: string | null;
  activa: boolean;
}

export interface Cliente {
  id: string; // MISMO id que PrometIO
  tenant_id: string;
  mesa_id: string | null;
  nombre: string;
  slug: string;
  logo_url: string | null;
  color_primario: string | null;
  basecamp_project_id: number | null;
  basecamp_importado_at: string | null;
  config: Record<string, unknown>;
  activo: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Usuario {
  id: string;
  tenant_id: string;
  nombre: string;
  email: string;
  rol: Rol;
  avatar_url: string | null;
  basecamp_user_id: number | null;
  capacidad_semanal: number;
  activo: boolean;
}

export interface Plantilla {
  id: string;
  tenant_id: string;
  nombre: string;
  descripcion: string | null;
  tipo: TipoPlantilla;
  activa: boolean;
  recurrente: boolean;
  patron_nombre: string | null;
  pilar: 'Marca' | 'Crecimiento' | 'Transformación' | 'Transversal' | 'Medios' | null;
  familia: string | null;
  unidad: string | null;
  precio_referencia: string | null;
  cliente_id: string | null;
}

export interface PlantillaBloque {
  id: string;
  tenant_id: string;
  plantilla_id: string;
  nombre: string;
  peso: number;
  orden: number;
  opcional: boolean;
}

export interface PlantillaTarea {
  id: string;
  tenant_id: string;
  bloque_id: string;
  titulo_interno: string;
  etiqueta_cliente: string | null;
  visible_cliente_default: boolean;
  peso_relativo: number;
  dias_offset: number;
  rol_sugerido: string | null;
  orden: number;
}

export interface PasoPieza {
  titulo: string;
  rol?: string | null;
  dias_offset: number; // días ANTES del posteo/entrega
  peso: number;
  visible: boolean;
  etiqueta?: string | null;
  aprobacion_cliente?: boolean;
}

export interface TipoPieza {
  id: string;
  tenant_id: string;
  nombre: string;
  slug: string;
  esfuerzo: number; // peso relativo por unidad
  pasos: PasoPieza[];
  activo: boolean;
}

export interface PlantillaArbol extends Plantilla {
  bloques: (PlantillaBloque & { tareas: PlantillaTarea[] })[];
}

export interface Proyecto {
  id: string;
  tenant_id: string;
  cliente_id: string;
  plantilla_id: string | null;
  prometio_cotizacion_id: string | null;
  nombre: string;
  brief: Record<string, unknown>;
  fecha_inicio: string;
  fecha_entrega: string;
  owner_ejecutiva: string | null;
  estado: EstadoOperativo;
  basecamp_todoset_id: number | null;
  basecamp_todolist_id: number | null;
  sync_estado: SyncEstado;
  mesa_id: string | null;
  basecamp_grupos: Record<string, number>;
  valor_cotizado: number | null;
  portal_token: string | null;
  portal_activo: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Requerimiento {
  id: string;
  tenant_id: string;
  cliente_id: string;
  proyecto_id: string | null;
  bloque_nombre: string | null;
  plantilla_tarea_id: string | null;
  titulo_interno: string;
  etiqueta_cliente: string | null;
  visible_cliente: boolean;
  tipo_trabajo: TipoTrabajo;
  estado_operativo: EstadoOperativo;
  estado_aprobacion: EstadoAprobacion;
  prioridad: Prioridad;
  peso: number;
  fecha_pedido: string | null;
  fecha_entrega: string | null;
  fecha_entrega_original: string | null;
  veces_reprogramado: number;
  owner_agencia: string[];
  owner_cliente: string[] | null;
  piezas: number;
  tipo_pieza_id: string | null;
  brief_url: string | null;
  entregable_urls: string[] | null;
  basecamp_todo_id: number | null;
  basecamp_todolist_id: number | null;
  basecamp_url: string | null;
  ultima_actualizacion: string;
  completado_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  deleted_at: string | null;
}

/** Fila de la vista v_requerimientos_metricas */
export interface RequerimientoMetricas extends Requerimiento {
  dias_atraso: number;
  dias_sin_movimiento: number;
  peso_completado: number;
}

export interface Semana {
  id: string;
  tenant_id: string;
  anio: number;
  numero_iso: number;
  fecha_inicio: string;
  fecha_fin: string;
  plan_publicado_at: string | null;
  acta_publicada_at: string | null;
}

export type SeveridadSenal = 'critica' | 'alta' | 'media';

export type TipoSenal =
  | 'arrastre_reincidente'
  | 'concentracion_carga'
  | 'bloqueo_cliente'
  | 'cuenta_silenciosa'
  | 'compromiso_vencido'
  | 'sobrecarga_proyectada'
  | 'sin_movimiento'
  | 'atraso_critico';

export interface Senal {
  id: string;
  tenant_id: string;
  semana_id: string;
  tipo: TipoSenal;
  severidad: SeveridadSenal;
  entidad_tipo: 'requerimiento' | 'usuario' | 'cliente' | 'proyecto' | 'acuerdo';
  entidad_id: string;
  titulo: string;
  detalle: Record<string, unknown>;
  atendida: boolean;
  created_at: string;
}

export interface Acuerdo {
  id: string;
  tenant_id: string;
  semana_id: string;
  descripcion: string;
  responsable_id: string;
  fecha_compromiso: string;
  estado: 'pendiente' | 'cumplido' | 'cancelado';
  cerrado_at: string | null;
  created_at: string;
}

export interface Acta {
  id: string;
  tenant_id: string;
  semana_id: string;
  tipo: 'plan_operativo' | 'cierre' | 'informe_mensual';
  mesa_id: string | null;
  contenido: Record<string, unknown>;
  markdown: string;
  publicado_at: string | null;
  publicado_por: string | null;
}

/** Brief estructurado (paso 2 del Builder). Se guarda versionado en proyectos.brief */
export interface BriefProyecto {
  version: number;
  objetivo_negocio: string;
  publico_objetivo: string;
  canales: string[];
  mandatorios_marca?: string;
  presupuesto_aprobado?: number | null;
  archivos_referencia?: string[];
  creado_at: string;
}

export const CANALES: readonly string[] = [
  'Instagram',
  'Facebook',
  'TikTok',
  'LinkedIn',
  'YouTube',
  'Mailing',
  'Web',
  'POP / Retail',
  'Medios',
  'Otro',
];

/** Salidas de la capa de IA (Sprint 4). Solo se alimentan con datos estructurados de BackIO. */
export interface AgendaIA { causa: string; items: string[]; pregunta: string }
export interface WeeklyIA { narrativa: string; agenda: AgendaIA[]; generado_at: string }
export interface BriefIA {
  nombre_proyecto: string | null;
  objetivo_negocio: string;
  publico_objetivo: string;
  canales: string[];
  mandatorios_marca: string | null;
  fecha_entrega: string | null;
  presupuesto_aprobado: number | null;
  plantilla_sugerida_id: string | null;
  plantilla_sugerida_nombre: string | null;
  piezas_por_tipo: Record<string, number>;
  dudas: string[];
}
