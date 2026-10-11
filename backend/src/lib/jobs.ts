/**
 * Jobs programados en una sola tabla declarativa (auditoría 10/10, B10). La recorren el scheduler interno
 * (lib/scheduler.ts) y los disparadores externos (/api/cron).
 *
 * Antes cada job de calendario corría solo si el tick caía en su minuto exacto: un despliegue o reinicio a esa hora
 * lo perdía, y con dos réplicas corría dos veces. Ahora un job corre si «ahora ≥ objetivo» dentro de una tolerancia
 * y su ventana (día, semana, mes o tramo de intervalo) no figura en cron_runs; la fila única hace de candado.
 */
import { ZONA } from '@backio/shared';
import type { DbCtx } from './db/client';
import { serviceClient } from './db';
import { clientesConBasecamp, cerrarVentana, limpiarCronRuns, reclamarVentana, tenantsActivos } from './db/cron_runs';
import { reconcileTenant } from './basecamp/reconcile';
import { recalcularSenales } from './rituals/service';
import { notificar, procesarPendientes } from './notificaciones';
import { temaAgenda } from './rituals/signals';
import { iaDisponible } from './ia';
import { generarInformeMensual } from './ia/informe';
import { listMesas } from './db/mesas';
import { procesarRecurrencias } from './recurrencias';
import { importarBasecampCliente } from './basecamp/importar';
import { sincronizarHoras } from './horas';
import { congelarPeriodo, trimestreDe } from './kpis';
import { fotoDaily, fotoWeekly } from './evolutivo';

/** Instante en hora de Guayaquil. dia: 0 domingo … 6 sábado. clave: YYYY-MM-DD. */
export interface Momento {
  dia: number;
  hora: number;
  minuto: number;
  clave: string;
  ms: number;
}

export function momentoLocal(d: Date = new Date()): Momento {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    dia: dias[p.weekday ?? 'Mon'] ?? 1,
    hora: Number(p.hour),
    minuto: Number(p.minute),
    clave: `${p.year}-${p.month}-${p.day}`,
    ms: d.getTime(),
  };
}

/** Mes anterior (YYYY-MM) a una fecha YYYY-MM-DD. */
export function mesAnterior(clave: string): string {
  const [y, m] = clave.split('-').map(Number);
  const prev = new Date(Date.UTC(y!, (m ?? 1) - 2, 1));
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Devuelve la clave de la ventana si el job toca ahora, o null. */
type Ventana = (m: Momento) => string | null;

/**
 * Hora fija: toca desde hh:mm hasta hh:mm + tolerancia (minutos), en los días que pase el filtro. La tolerancia
 * recupera un tick perdido por un despliegue sin disparar, en el primer arranque, jobs de días o meses anteriores.
 */
export function aLas(hora: number, minuto: number, opts: { tolerancia?: number; cuando?: (m: Momento) => boolean } = {}): Ventana {
  const tolerancia = opts.tolerancia ?? 120;
  return (m) => {
    if (opts.cuando && !opts.cuando(m)) return null;
    const pasados = m.hora * 60 + m.minuto - (hora * 60 + minuto);
    return pasados >= 0 && pasados < tolerancia ? m.clave : null;
  };
}

/** Intervalo: una ventana por tramo de `minutos` (p. ej. cada 30 min). */
export function cada(minutos: number): Ventana {
  return (m) => `t${Math.floor(m.ms / (minutos * 60_000))}`;
}

const esLaborable = (m: Momento) => m.dia >= 1 && m.dia <= 5;
const esDomingo = (m: Momento) => m.dia === 0;
const esPrimeroDeMes = (m: Momento) => m.clave.endsWith('-01');

const ctxCron = (tenantId: string): DbCtx => ({ db: serviceClient(), tenantId, usuarioId: null, origen: 'cron' });

/** Corre fn por tenant; el fallo de uno no detiene al resto y queda en el resultado. */
async function porTenant(fn: (ctx: DbCtx) => Promise<unknown>): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const t of await tenantsActivos()) {
    try {
      out[t] = await fn(ctxCron(t));
    } catch (err) {
      out[t] = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  return out;
}

async function porMesaActiva(ctx: DbCtx, fn: (mesa: Awaited<ReturnType<typeof listMesas>>[number]) => Promise<unknown>) {
  const out: Record<string, unknown> = {};
  for (const mesa of (await listMesas(ctx)).filter((x) => x.activa)) {
    try {
      out[mesa.nombre] = (await fn(mesa)) ?? 'ok';
    } catch (err) {
      out[mesa.nombre] = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  return out;
}

export interface Job {
  nombre: string;
  descripcion: string;
  ventana: Ventana;
  /** false: corre en cada tick sin registro en cron_runs (p. ej. reintento de notificaciones, idempotente). */
  registrar?: boolean;
  /** Si devuelve false, el job no aplica ahora (p. ej. sin clave de IA) y no consume la ventana. */
  habilitado?: () => boolean;
  ejecutar: (m: Momento) => Promise<unknown>;
}

export const JOBS: Job[] = [
  {
    nombre: 'notificaciones',
    descripcion: 'Reintento de correos pendientes, cada minuto',
    ventana: cada(1),
    registrar: false,
    ejecutar: () => procesarPendientes(),
  },
  {
    nombre: 'reconcile',
    descripcion: 'Reconciliación con Basecamp, cada 30 min',
    ventana: cada(30),
    ejecutar: () => porTenant((ctx) => reconcileTenant(ctx)),
  },
  {
    // Red de seguridad del webhook todo_created: to-dos nuevos, renombres, movimientos, responsables y eliminados.
    // Basecamp es origen aceptado (23/09/2026): lo creado a mano entra solo.
    nombre: 'estructura',
    descripcion: 'Estructura de Basecamp, cada 15 min',
    ventana: cada(15),
    ejecutar: () =>
      porTenant(async (ctx) => {
        const out: Record<string, unknown> = {};
        for (const c of await clientesConBasecamp(ctx.tenantId))
          out[c.nombre] = await importarBasecampCliente(ctx, c.id).catch((e: Error) => ({ error: e.message }));
        return out;
      }),
  },
  {
    nombre: 'horas',
    descripcion: 'Horas de Basecamp, cada 6 h',
    ventana: cada(360),
    ejecutar: () => porTenant((ctx) => sincronizarHoras(ctx)),
  },
  {
    nombre: 'limpieza',
    descripcion: 'Contadores de límites y registro de jobs viejos, diario 03:30',
    ventana: aLas(3, 30),
    ejecutar: async () => {
      await serviceClient().rpc('limites_limpiar');
      await limpiarCronRuns();
    },
  },
  {
    nombre: 'informe_mensual',
    descripcion: 'Informe ejecutivo del mes anterior por mesa (solo se redacta; Operaciones lo publica), día 1 08:00',
    ventana: aLas(8, 0, { cuando: esPrimeroDeMes }),
    habilitado: iaDisponible,
    ejecutar: (m) => {
      const mes = mesAnterior(m.clave);
      return porTenant((ctx) =>
        porMesaActiva(ctx, async (mesa) => {
          await generarInformeMensual(ctx, mesa.id, mes);
          await notificar(
            { tenantId: ctx.tenantId },
            {
              tipo: 'informe_mensual',
              titulo: `Informe mensual ${mes} · ${mesa.nombre} listo para revisar`,
              cuerpo: 'BackIO redactó el informe ejecutivo del mes. Revísalo y publícalo en Basecamp desde Informes.',
              ruta: '/informes',
            },
            { roles: ['operaciones', 'admin'] },
          );
        }),
      );
    },
  },
  {
    nombre: 'recurrencias',
    descripcion: 'Fees recurrentes (genera el mes siguiente cuando llega el día configurado), diario 08:05',
    ventana: aLas(8, 5),
    ejecutar: () => porTenant((ctx) => procesarRecurrencias(ctx)),
  },
  {
    nombre: 'kpis_congelar',
    descripcion: 'Congela los KPIs automáticos del mes (y trimestre) anterior sin pisar ajustes, día 1 08:10',
    ventana: aLas(8, 10, { cuando: esPrimeroDeMes }),
    ejecutar: (m) => {
      const mes = mesAnterior(m.clave);
      const mesActual = Number(m.clave.slice(5, 7));
      const periodos = [mes, ...(mesActual % 3 === 1 ? [trimestreDe(mes)] : [])];
      return porTenant(async (ctx) => {
        const out: Record<string, number> = {};
        for (const p of periodos) out[p] = await congelarPeriodo(ctx, p);
        return out;
      });
    },
  },
  {
    // El cierre publicado ya deja la foto; esto cubre los días sin cierre.
    nombre: 'foto_daily',
    descripcion: 'Evolutivo: foto del día de cada mesa, L-V 19:30',
    ventana: aLas(19, 30, { cuando: esLaborable }),
    ejecutar: (m) => porTenant((ctx) => porMesaActiva(ctx, (mesa) => fotoDaily(ctx, mesa, m.clave, 'cron').then(() => 'ok'))),
  },
  {
    nombre: 'foto_semana',
    descripcion: 'Evolutivo: foto de la semana que cierra, domingo 17:55 (antes de las señales)',
    ventana: aLas(17, 55, { cuando: esDomingo }),
    ejecutar: (m) => porTenant((ctx) => fotoWeekly(ctx, m.clave)),
  },
  {
    nombre: 'senales',
    descripcion: 'Señales y agenda del weekly, domingo 18:00',
    ventana: aLas(18, 0, { cuando: esDomingo }),
    ejecutar: () =>
      porTenant(async (ctx) => {
        const s = await recalcularSenales(ctx);
        const criticas = s.filter((x) => x.severidad === 'critica');
        const lineas = s.slice(0, 15).map((x) => `• [${x.severidad.toUpperCase()}] ${x.titulo} → ${temaAgenda(x.tipo)}`);
        await notificar(
          { tenantId: ctx.tenantId },
          {
            tipo: 'agenda_weekly',
            titulo: `Agenda del weekly: ${s.length} señales (${criticas.length} críticas)`,
            cuerpo: lineas.length ? lineas.join('\n') : 'Sin señales esta semana.',
            ruta: '/weekly',
          },
          { roles: ['operaciones', 'admin'] },
        );
        return s.length;
      }),
  },
];

export const jobPorNombre = (nombre: string): Job | undefined => JOBS.find((j) => j.nombre === nombre);

/** Resumen corto para el registro: si algún tenant o mesa falló, ok = false. */
function resumir(resultado: unknown): { ok: boolean; detalle: string } {
  const texto = JSON.stringify(resultado ?? null) ?? 'null';
  return { ok: !texto.includes('"error"'), detalle: texto };
}

/**
 * Ejecuta un job si le toca (o siempre, con `manual`). Devuelve null si no tocaba o ya se había ejecutado.
 * Los errores no salen de aquí: quedan en cron_runs y en el log.
 */
export async function ejecutarJob(
  job: Job,
  m: Momento,
  opts: { manual?: boolean } = {},
): Promise<{ ventana: string; resultado: unknown } | null> {
  if (job.habilitado && !job.habilitado()) return null;
  const ventana = opts.manual ? `manual:${new Date(m.ms).toISOString()}` : job.ventana(m);
  if (!ventana) return null;
  if (job.registrar !== false && !(await reclamarVentana(job.nombre, ventana))) return null;
  try {
    const resultado = await job.ejecutar(m);
    if (job.registrar !== false) {
      const r = resumir(resultado);
      await cerrarVentana(job.nombre, ventana, r.ok, r.detalle);
      if (!r.ok) console.error(`[jobs] ${job.nombre} ${ventana} con errores`, r.detalle.slice(0, 500));
    }
    return { ventana, resultado };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    console.error(`[jobs] ${job.nombre} ${ventana} falló`, mensaje);
    if (job.registrar !== false) await cerrarVentana(job.nombre, ventana, false, mensaje);
    return { ventana, resultado: { error: mensaje } };
  }
}
