/**
 * Motor de señales (docs/05-rituales.md)
 * Principio: las reglas deciden, la IA solo redacta. Reglas deterministas y puras
 * sobre un WeekContext; los umbrales viven en tenants.config.signal_thresholds.
 */
import type { RequerimientoMetricas, Usuario, Acuerdo, Cliente, TipoSenal, SeveridadSenal } from '@backio/shared';

export interface SignalThresholds {
  arrastre_reincidente_min: number;
  concentracion_carga_pct: number;
  bloqueo_cliente_dias: number;
  cuenta_silenciosa_dias: number;
  sin_movimiento_dias: number;
  atraso_critico_dias: number;
}

export const UMBRALES_DEFAULT: SignalThresholds = {
  arrastre_reincidente_min: 2,
  concentracion_carga_pct: 30,
  bloqueo_cliente_dias: 5,
  cuenta_silenciosa_dias: 14,
  sin_movimiento_dias: 14,
  atraso_critico_dias: 30,
};

export interface WeekContext {
  hoy: string; // YYYY-MM-DD
  semana: { fecha_inicio: string; fecha_fin: string };
  /** Todos los requerimientos activos del tenant (no completados/cancelados) con métricas. */
  activos: RequerimientoMetricas[];
  /** Requerimientos completados en los últimos N días (para cuenta_silenciosa). */
  completadosRecientes: Pick<RequerimientoMetricas, 'cliente_id' | 'completado_at'>[];
  usuarios: Usuario[];
  clientes: Pick<Cliente, 'id' | 'nombre' | 'activo'>[];
  acuerdosAbiertos: Acuerdo[];
  umbrales?: Partial<SignalThresholds>;
  /** Reprogramaciones y reprocesos sin causa (últimos 45 días). Opcional para compatibilidad. */
  sinMotivo?: { reprogramaciones: { requerimiento_id: string }[]; reprocesos: { requerimiento_id: string; origen: string }[] };
}

export interface SignalOut {
  tipo: TipoSenal;
  severidad: SeveridadSenal;
  entidad_tipo: 'requerimiento' | 'usuario' | 'cliente' | 'proyecto' | 'acuerdo';
  entidad_id: string;
  titulo: string;
  detalle: Record<string, unknown>;
}

export interface SignalRule {
  tipo: TipoSenal;
  severidad: SeveridadSenal;
  tema_agenda: string;
  detectar: (ctx: WeekContext, u: SignalThresholds) => SignalOut[];
}

const nombreDe = (ctx: WeekContext, id: string) => ctx.usuarios.find((u) => u.id === id)?.nombre ?? 'Sin asignar';
const clienteDe = (ctx: WeekContext, id: string) => ctx.clientes.find((c) => c.id === id)?.nombre ?? 'Cliente';

const enSemana = (ctx: WeekContext, r: RequerimientoMetricas) =>
  !!r.fecha_entrega && r.fecha_entrega >= ctx.semana.fecha_inicio && r.fecha_entrega <= ctx.semana.fecha_fin;

export const REGLAS: SignalRule[] = [
  {
    tipo: 'compromiso_vencido',
    severidad: 'critica',
    tema_agenda: 'Rendición de cuentas',
    detectar: (ctx) =>
      ctx.acuerdosAbiertos
        .filter((a) => a.estado === 'pendiente' && a.fecha_compromiso < ctx.hoy)
        .map((a) => ({
          tipo: 'compromiso_vencido',
          severidad: 'critica',
          entidad_tipo: 'acuerdo',
          entidad_id: a.id,
          titulo: `${nombreDe(ctx, a.responsable_id)}: "${a.descripcion}" venció el ${a.fecha_compromiso}`,
          detalle: { responsable_id: a.responsable_id, fecha_compromiso: a.fecha_compromiso },
        })),
  },
  {
    tipo: 'arrastre_reincidente',
    severidad: 'critica',
    tema_agenda: 'Decidir: se hace, se reasigna o se mata',
    detectar: (ctx, u) =>
      ctx.activos
        .filter((r) => r.veces_reprogramado >= u.arrastre_reincidente_min)
        .map((r) => ({
          tipo: 'arrastre_reincidente',
          severidad: 'critica',
          entidad_tipo: 'requerimiento',
          entidad_id: r.id,
          titulo: `"${r.titulo_interno}" (${clienteDe(ctx, r.cliente_id)}) reprogramado ${r.veces_reprogramado} veces`,
          detalle: { veces: r.veces_reprogramado, fecha_original: r.fecha_entrega_original, fecha_actual: r.fecha_entrega },
        })),
  },
  {
    tipo: 'concentracion_carga',
    severidad: 'critica',
    tema_agenda: 'Redistribución de carga — riesgo de punto único',
    detectar: (ctx, u) => {
      const semana = ctx.activos.filter((r) => enSemana(ctx, r));
      const total = semana.length;
      if (total < 3) return [];
      const porOwner = new Map<string, number>();
      for (const r of semana) {
        const o = r.owner_agencia[0];
        if (o) porOwner.set(o, (porOwner.get(o) ?? 0) + 1);
      }
      return [...porOwner.entries()]
        .filter(([, n]) => (n / total) * 100 > u.concentracion_carga_pct)
        .map(([ownerId, n]) => {
          const pct = Math.round((n / total) * 100);
          return {
            tipo: 'concentracion_carga' as const,
            severidad: 'critica' as const,
            entidad_tipo: 'usuario' as const,
            entidad_id: ownerId,
            titulo: `${nombreDe(ctx, ownerId)} concentra ${n} de ${total} tareas (${pct}%)`,
            detalle: { nombre: nombreDe(ctx, ownerId), tareas: n, total, pct },
          };
        });
    },
  },
  {
    tipo: 'bloqueo_cliente',
    severidad: 'alta',
    tema_agenda: 'Escalamiento a ejecutiva de cuenta',
    detectar: (ctx, u) =>
      ctx.activos
        .filter((r) => r.estado_aprobacion === 'pendiente_cliente' && r.dias_sin_movimiento > u.bloqueo_cliente_dias)
        .map((r) => ({
          tipo: 'bloqueo_cliente',
          severidad: 'alta',
          entidad_tipo: 'requerimiento',
          entidad_id: r.id,
          titulo: `${clienteDe(ctx, r.cliente_id)} debe "${r.etiqueta_cliente ?? r.titulo_interno}" hace ${r.dias_sin_movimiento} días`,
          detalle: { dias: r.dias_sin_movimiento, cliente_id: r.cliente_id },
        })),
  },
  {
    tipo: 'cuenta_silenciosa',
    severidad: 'alta',
    tema_agenda: 'Revisión de estado de cuenta',
    detectar: (ctx, u) => {
      const limite = new Date(`${ctx.hoy}T00:00:00Z`).getTime() - u.cuenta_silenciosa_dias * 86_400_000;
      const conMovimiento = new Set(
        ctx.completadosRecientes
          .filter((r) => r.completado_at && new Date(r.completado_at).getTime() >= limite)
          .map((r) => r.cliente_id),
      );
      const conActivos = new Set(ctx.activos.map((r) => r.cliente_id));
      return ctx.clientes
        .filter((c) => c.activo && conActivos.has(c.id) && !conMovimiento.has(c.id))
        .map((c) => ({
          tipo: 'cuenta_silenciosa' as const,
          severidad: 'alta' as const,
          entidad_tipo: 'cliente' as const,
          entidad_id: c.id,
          titulo: `${c.nombre}: sin entregas completadas en ${u.cuenta_silenciosa_dias} días`,
          detalle: { dias: u.cuenta_silenciosa_dias, activos: ctx.activos.filter((r) => r.cliente_id === c.id).length },
        }));
    },
  },
  {
    tipo: 'sobrecarga_proyectada',
    severidad: 'alta',
    tema_agenda: 'Recortar alcance de la semana',
    detectar: (ctx) => {
      // Capacidad declarada en horas/semana; se asume 4h promedio por tarea (calibrable).
      const HORAS_POR_TAREA = 4;
      const semana = ctx.activos.filter((r) => enSemana(ctx, r));
      return ctx.usuarios
        .filter((u) => u.activo)
        .map((u) => ({ u, n: semana.filter((r) => r.owner_agencia.includes(u.id)).length }))
        .filter(({ u, n }) => n * HORAS_POR_TAREA > u.capacidad_semanal)
        .map(({ u, n }) => ({
          tipo: 'sobrecarga_proyectada' as const,
          severidad: 'alta' as const,
          entidad_tipo: 'usuario' as const,
          entidad_id: u.id,
          titulo: `${u.nombre}: ${n} tareas (~${n * HORAS_POR_TAREA}h) sobre ${u.capacidad_semanal}h declaradas`,
          detalle: { tareas: n, horas_estimadas: n * HORAS_POR_TAREA, capacidad: u.capacidad_semanal },
        }));
    },
  },
  {
    tipo: 'sin_movimiento',
    severidad: 'media',
    tema_agenda: 'Requerimiento huérfano',
    detectar: (ctx, u) =>
      ctx.activos
        .filter((r) => r.dias_sin_movimiento > u.sin_movimiento_dias && r.estado_aprobacion !== 'pendiente_cliente')
        .map((r) => ({
          tipo: 'sin_movimiento',
          severidad: 'media',
          entidad_tipo: 'requerimiento',
          entidad_id: r.id,
          titulo: `"${r.titulo_interno}" (${clienteDe(ctx, r.cliente_id)}) sin movimiento hace ${r.dias_sin_movimiento} días`,
          detalle: { dias: r.dias_sin_movimiento, owner: r.owner_agencia[0] ?? null },
        })),
  },
  {
    tipo: 'atraso_critico',
    severidad: 'critica',
    tema_agenda: 'Atraso material — decisión de cuenta',
    detectar: (ctx, u) =>
      ctx.activos
        .filter((r) => r.dias_atraso > u.atraso_critico_dias)
        .map((r) => ({
          tipo: 'atraso_critico',
          severidad: 'critica',
          entidad_tipo: 'requerimiento',
          entidad_id: r.id,
          titulo: `"${r.titulo_interno}" (${clienteDe(ctx, r.cliente_id)}) lleva ${r.dias_atraso} días de atraso`,
          detalle: { dias_atraso: r.dias_atraso, fecha_entrega: r.fecha_entrega },
        })),
  },
];

const ORDEN: Record<SeveridadSenal, number> = { critica: 0, alta: 1, media: 2 };

const REGLAS_CUMPLIMIENTO: SignalRule[] = [
  {
    tipo: 'reproceso_reincidente',
    severidad: 'critica',
    tema_agenda: 'Revisar brief y control de calidad antes de enviar',
    detectar: (ctx) =>
      ctx.activos
        .filter((r) => (r.veces_reproceso ?? 0) >= 2)
        .map((r) => ({
          tipo: 'reproceso_reincidente', severidad: 'critica', entidad_tipo: 'requerimiento', entidad_id: r.id,
          titulo: `${clienteDe(ctx, r.cliente_id)} · "${r.titulo_interno}" lleva ${r.veces_reproceso} reprocesos (${nombreDe(ctx, r.owner_agencia[0] ?? '')})`,
          detalle: { veces_reproceso: r.veces_reproceso, owner: r.owner_agencia[0] ?? null },
        })),
  },
  {
    tipo: 'reprogramacion_sin_motivo',
    severidad: 'media',
    tema_agenda: 'Completar la causa de la reprogramación',
    detectar: (ctx) => {
      const ids = new Set((ctx.sinMotivo?.reprogramaciones ?? []).map((x) => x.requerimiento_id));
      return ctx.activos.filter((r) => ids.has(r.id)).map((r) => ({
        tipo: 'reprogramacion_sin_motivo', severidad: 'media', entidad_tipo: 'requerimiento', entidad_id: r.id,
        titulo: `${clienteDe(ctx, r.cliente_id)} · "${r.titulo_interno}" se reprogramó sin causa registrada`,
        detalle: { owner: r.owner_agencia[0] ?? null },
      }));
    },
  },
  {
    tipo: 'reproceso_sin_motivo',
    severidad: 'media',
    tema_agenda: 'Completar la causa del reproceso',
    detectar: (ctx) => {
      const por = new Map((ctx.sinMotivo?.reprocesos ?? []).map((x) => [x.requerimiento_id, x.origen]));
      return ctx.activos.filter((r) => por.has(r.id)).map((r) => ({
        tipo: 'reproceso_sin_motivo', severidad: 'media', entidad_tipo: 'requerimiento', entidad_id: r.id,
        titulo: `${clienteDe(ctx, r.cliente_id)} · "${r.titulo_interno}" volvió al equipo (${por.get(r.id) === 'basecamp' ? 'desmarcado en Basecamp' : por.get(r.id)}) sin causa registrada`,
        detalle: { origen: por.get(r.id) ?? null, owner: r.owner_agencia[0] ?? null },
      }));
    },
  },
];
REGLAS.push(...REGLAS_CUMPLIMIENTO);

export function calcularSenales(ctx: WeekContext): SignalOut[] {
  const u = { ...UMBRALES_DEFAULT, ...(ctx.umbrales ?? {}) };
  return REGLAS.flatMap((r) => r.detectar(ctx, u)).sort((a, b) => ORDEN[a.severidad] - ORDEN[b.severidad]);
}

export function temaAgenda(tipo: TipoSenal): string {
  return REGLAS.find((r) => r.tipo === tipo)?.tema_agenda ?? tipo;
}
