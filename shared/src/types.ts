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
  /** Equipo funcional: define qué KPIs le aplican (migración 22). */
  area?: Area | null;
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
  recurrencia_id: string | null;
  periodo: string | null;
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
  veces_reproceso: number;
  /** planificado (entró por el weekly) · no_planificado (entró durante la semana) · urgente */
  planificacion: 'planificado' | 'no_planificado' | 'urgente';
  /** Día en que la mesa decidió trabajarla (selección del daily). */
  daily_fecha: string | null;
  owner_agencia: string[];
  owner_cliente: string[] | null;
  piezas: number;
  tipo_pieza_id: string | null;
  /** tarea · propuesta (cuenta para campañas aprobadas) · incidencia (SLA de resolución). Migración 22. */
  clase?: ClaseTarea;
  /** Propuesta proactiva: no la pidió el cliente (KPIs de proactividad). */
  proactiva?: boolean;
  /** Primera respuesta efectiva al cliente (botón «Respondido»), para el SLA de Cuentas. */
  primera_respuesta_at?: string | null;
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
  | 'atraso_critico'
  | 'reproceso_reincidente'
  | 'reprogramacion_sin_motivo'
  | 'reproceso_sin_motivo';

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

/** Cumplimiento: reprogramaciones y reprocesos (04/09/2026). Solo motivos de catálogo; nunca texto libre. */
export type MotivoReprogramacion = 'insumos_cliente' | 'cambio_alcance' | 'capacidad_equipo' | 'prioridad_negocio' | 'error_estimacion' | 'reproceso' | 'otro';
export type MotivoReproceso = 'brief_incompleto' | 'levantamiento_incompleto' | 'error_ejecucion' | 'cambio_opinion_cliente' | 'ajuste_marca_legal' | 'direccion_arte' | 'error_texto';
export type OrigenReproceso = 'cliente' | 'interno' | 'basecamp';

/** atribuible: a quién se le cuenta. equipo = descuenta al equipo; cliente = no; neutro = ninguno. */
export const MOTIVOS_REPROGRAMACION: { valor: MotivoReprogramacion; label: string; atribuible: 'equipo' | 'cliente' | 'neutro' }[] = [
  { valor: 'insumos_cliente', label: 'Insumos o aprobación del cliente', atribuible: 'cliente' },
  { valor: 'cambio_alcance', label: 'Cambio de alcance', atribuible: 'cliente' },
  { valor: 'capacidad_equipo', label: 'Capacidad del equipo', atribuible: 'equipo' },
  { valor: 'prioridad_negocio', label: 'Prioridad de negocio', atribuible: 'neutro' },
  { valor: 'error_estimacion', label: 'Error de estimación', atribuible: 'equipo' },
  { valor: 'reproceso', label: 'Reproceso', atribuible: 'equipo' },
  { valor: 'otro', label: 'Otro', atribuible: 'neutro' },
];
export const MOTIVOS_REPROCESO: { valor: MotivoReproceso; label: string; responsable: 'ejecutiva' | 'equipo' | 'cliente' | 'lider' }[] = [
  { valor: 'brief_incompleto', label: 'Brief incompleto o ambiguo', responsable: 'ejecutiva' },
  { valor: 'levantamiento_incompleto', label: 'Info incompleta o incorrecta del levantamiento', responsable: 'ejecutiva' },
  { valor: 'error_ejecucion', label: 'Error de ejecución', responsable: 'equipo' },
  { valor: 'cambio_opinion_cliente', label: 'Cambio de opinión del cliente', responsable: 'cliente' },
  { valor: 'ajuste_marca_legal', label: 'Ajuste de marca o legal', responsable: 'cliente' },
  { valor: 'direccion_arte', label: 'Dirección de arte', responsable: 'lider' },
  { valor: 'error_texto', label: 'Error de texto', responsable: 'equipo' },
];
export const PASOS_RETORNO: readonly string[] = ['Idea', 'Guion', 'Copy', 'Storyboard', 'Diseño', 'Grabación', 'Edición', 'Posteo'];

export interface Reprogramacion {
  id: string; tenant_id: string; requerimiento_id: string; fecha_anterior: string | null; fecha_nueva: string | null;
  motivo: MotivoReprogramacion | null; origen: string; usuario_id: string | null; created_at: string; observacion?: string | null;
}
/** Observación fechada de una tarea (bitácora con el cliente). */
export interface Bitacora {
  id: string; tenant_id: string; requerimiento_id: string; usuario_id: string | null;
  nota: string; estado_operativo: EstadoOperativo | null; estado_aprobacion: string | null;
  visible_cliente: boolean; created_at: string;
}
export interface Reproceso {
  id: string; tenant_id: string; requerimiento_id: string; origen: OrigenReproceso; motivo: MotivoReproceso | null; paso_retorno: string | null;
  fecha_entrega_antes: string | null; abierto_at: string; cerrado_at: string | null; horas_reproceso: number | null; usuario_id: string | null; created_at: string; observacion?: string | null;
  /** Área a la que se le cuenta el retrabajo y si es del equipo, del cliente o externo (migración 22). */
  area_responsable?: Area | null; atribuible?: Atribuible | null;
}
export interface HistorialRequerimiento { reprogramaciones: Reprogramacion[]; reprocesos: Reproceso[] }

/** Recurrencia mensual de un fee (D2, 04/09/2026). */
export interface Recurrencia {
  id: string; tenant_id: string; cliente_id: string; plantilla_id: string; nombre_patron: string;
  brief: Record<string, unknown>; bloques: unknown[]; owner_ejecutiva: string | null;
  dia_generacion: number; activa: boolean; ultimo_mes_generado: string | null; ultimo_proyecto_id: string | null; proyecto_origen_id: string | null;
  created_by: string | null; created_at: string; updated_at: string;
}

export const PLANIFICACION_LABEL: Record<'planificado' | 'no_planificado' | 'urgente', string> = { planificado: 'Planificado', no_planificado: 'No planificado', urgente: 'Urgente' };

// ---------------------------------------------------------------- KPIs (25/09/2026, docs/19-kpis.md)
export type Area = 'cuentas' | 'produccion' | 'diseno' | 'creatividad' | 'content';
export const AREAS: Area[] = ['cuentas', 'produccion', 'diseno', 'creatividad', 'content'];
export const AREA_LABEL: Record<Area, string> = { cuentas: 'Ejecutiva de Cuentas', produccion: 'Producción', diseno: 'Arte y Diseño', creatividad: 'Creatividad', content: 'Content' };
export type ClaseTarea = 'tarea' | 'propuesta' | 'incidencia';
export const CLASE_LABEL: Record<ClaseTarea, string> = { tarea: 'Tarea', propuesta: 'Propuesta', incidencia: 'Incidencia' };
export type Atribuible = 'equipo' | 'cliente' | 'externo';
export const ATRIBUIBLE_LABEL: Record<Atribuible, string> = { equipo: 'Del equipo', cliente: 'Del cliente', externo: 'Externo' };

/** SLA de primera respuesta / resolución por prioridad, en minutos hábiles (L-V 09:00–18:00 Guayaquil). */
export const SLA_MINUTOS: Record<Prioridad, number> = { alta: 30, media: 90, baja: 480 };

export type CalculoKpi = 'a_tiempo' | 'retrabajo' | 'levantamiento' | 'aprobacion_primera' | 'propuestas_aprobadas' | 'sla_respuesta' | 'sla_incidencia' | 'proactividad' | 'manual';
export const CALCULO_KPI_LABEL: Record<CalculoKpi, string> = {
  a_tiempo: 'Entregas a tiempo', retrabajo: 'Retrabajo atribuible', levantamiento: 'Levantamiento correcto',
  aprobacion_primera: 'Aprobación en 1ª revisión', propuestas_aprobadas: 'Propuestas aprobadas', sla_respuesta: 'SLA de primera respuesta',
  sla_incidencia: 'Incidencias dentro de SLA', proactividad: 'Proactividad', manual: 'Manual',
};

export interface KpiDefinicion {
  id: string; tenant_id: string; codigo: string; area: Area; indicador: string;
  periodicidad: 'mensual' | 'trimestral'; operador: '>=' | '<='; meta: number; tipo: 'porcentaje' | 'margen';
  numerador_label: string; denominador_label: string; denominador_fijo: number | null; calculo: CalculoKpi;
  fuente: string | null; regla: string | null; formula: string | null; activo: boolean; orden: number;
}

export interface KpiMedicion {
  id: string; tenant_id: string; kpi_id: string; periodo: string; usuario_id: string | null;
  dato_a: number | null; dato_b: number | null; meta_individual: number | null; origen: 'auto' | 'manual' | 'ajustado';
  justificacion_ajuste: string | null; tasa_respuesta: number | null; causa: string | null; atribuible: Atribuible | null;
  evidencia_url: string | null; plan_mejora: string | null; responsable_id: string | null; fecha_seguimiento: string | null;
  registrado_por: string | null; updated_at: string;
}

/** Valor de un KPI en un nivel (persona o equipo) y periodo. */
export interface KpiValor {
  dato_a: number | null; dato_b: number | null; resultado: number | null; meta: number;
  estado: 'cumple' | 'no_cumple' | 'sin_dato';
  origen: 'auto' | 'manual' | 'ajustado' | 'sin_dato';
  /** Automático calculado con datos anteriores a las features de la migración 22 (proxy). */
  estimado: boolean;
  medicion: KpiMedicion | null;
}

export interface KpiFilaPersona { usuario_id: string; nombre: string; avatar_url: string | null; valor: KpiValor }

export interface KpiTablero {
  periodo: string; en_curso: boolean;
  areas: { area: Area; integrantes: number; kpis: { definicion: KpiDefinicion; equipo: KpiValor; personas: KpiFilaPersona[]; serie: { periodo: string; resultado: number | null; estado: KpiValor['estado'] }[] }[] }[];
  resumen: { cumple: number; no_cumple: number; sin_dato: number };
  sin_area: { usuario_id: string; nombre: string }[];
}

export interface KpiDetalleTarea { id: string; titulo: string; cliente: string; responsables: string; fecha: string | null; basecamp_url: string | null; cuenta_en_a: boolean; nota: string | null }
