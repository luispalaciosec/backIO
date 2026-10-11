/**
 * Vigía de los jobs programados (deuda técnica §8.2). Corre cada hora como un job más y avisa una sola vez por
 * problema: queda el error en el log (y en Sentry) y llega un correo a las personas admin con enlace a
 * Admin → Servicios. Dos casos:
 *  - Un job de hora fija (p. ej. señales del domingo 18:00) cuya ventana ya cerró sin registro en cron_runs.
 *  - Un job de intervalo (p. ej. reconcile cada 30 min) sin ninguna corrida en tres intervalos.
 * Un job que corrió pero terminó con errores no se repite aquí: ese error ya se registró al correr.
 */
import type { Job } from './jobs';
import { momentoLocal } from './jobs';
import { inicioDelRegistro, reclamarVentana, tenantsActivos, ultimasCorridas, ventanasRegistradas } from './db/cron_runs';
import { notificar } from './notificaciones';
import { log } from './logger';

/** Margen para que un job recién abierto alcance a registrarse antes de declararlo perdido. */
const MARGEN_MS = 10 * 60_000;
/** Cuánto hacia atrás se miran las ventanas de hora fija (cubre un día completo con holgura). */
const ALCANCE_MS = 26 * 3600_000;

export interface Problema {
  job: string;
  descripcion: string;
  /** Clave para avisar una sola vez: la ventana perdida o el día del atraso. */
  clave: string;
  detalle: string;
}

const deHoraFija = (j: Job) => j.intervaloMin === undefined && j.registrar !== false && j.nombre !== 'vigia';
const habilitado = (j: Job) => !j.habilitado || j.habilitado();

/**
 * Ventanas de los jobs de hora fija que cerraron entre hace 26 h y hace 10 min. Recorre minuto a minuto y se queda
 * con las claves que ya no están abiertas: así sirve la misma definición de ventana que usa el scheduler.
 */
export function ventanasCerradas(jobs: Job[], ahoraMs: number, desdeMs = ahoraMs - ALCANCE_MS): { job: Job; ventana: string }[] {
  const fijos = jobs.filter((j) => deHoraFija(j) && habilitado(j));
  const abiertas = new Set<string>();
  for (let t = ahoraMs - MARGEN_MS; t <= ahoraMs; t += 60_000) {
    const m = momentoLocal(new Date(t));
    for (const j of fijos) {
      const v = j.ventana(m);
      if (v) abiertas.add(`${j.nombre}|${v}`);
    }
  }
  // Una ventana que empezó antes de `desdeMs` no se juzga (p. ej. antes de que existiera el registro).
  const previas = new Set<string>();
  const cerradas = new Map<string, { job: Job; ventana: string }>();
  for (let t = ahoraMs - ALCANCE_MS; t < ahoraMs - MARGEN_MS; t += 60_000) {
    const m = momentoLocal(new Date(t));
    for (const j of fijos) {
      const v = j.ventana(m);
      const k = `${j.nombre}|${v}`;
      if (!v) continue;
      if (t < desdeMs) previas.add(k);
      else if (!abiertas.has(k) && !previas.has(k)) cerradas.set(k, { job: j, ventana: v });
    }
  }
  return [...cerradas.values()];
}

/** Lo que hoy está mal, sin avisar todavía. */
export async function revisarJobs(jobs: Job[], ahoraMs: number): Promise<Problema[]> {
  const problemas: Problema[] = [];
  const inicio = await inicioDelRegistro();
  const cerradas = ventanasCerradas(jobs, ahoraMs, Math.max(ahoraMs - ALCANCE_MS, inicio ?? ahoraMs));
  const registradas = await ventanasRegistradas(cerradas.map((c) => ({ job: c.job.nombre, ventana: c.ventana })));
  for (const c of cerradas)
    if (!registradas.has(`${c.job.nombre}|${c.ventana}`))
      problemas.push({
        job: c.job.nombre,
        descripcion: c.job.descripcion,
        clave: c.ventana,
        detalle: `No corrió en su ventana del ${c.ventana}.`,
      });

  const ultimas = await ultimasCorridas();
  const hoy = momentoLocal(new Date(ahoraMs)).clave;
  for (const j of jobs.filter((x) => x.intervaloMin !== undefined && habilitado(x))) {
    const ultima = ultimas.get(j.nombre);
    const limiteMs = Math.max(3 * j.intervaloMin!, 90) * 60_000;
    const hace = ultima ? ahoraMs - Date.parse(ultima.inicio_at) : null;
    if (hace === null || hace > limiteMs)
      problemas.push({
        job: j.nombre,
        descripcion: j.descripcion,
        clave: `atraso:${hoy}`,
        detalle: ultima ? `Última corrida hace ${Math.round(hace! / 60_000)} min.` : 'No hay corridas registradas.',
      });
  }
  return problemas;
}

/** Revisa y avisa los problemas nuevos (cada uno una sola vez: el aviso reclama su propia fila en cron_runs). */
export async function vigilar(jobs: Job[], ahoraMs = Date.now()): Promise<{ problemas: number; avisados: number }> {
  const problemas = await revisarJobs(jobs, ahoraMs);
  let avisados = 0;
  for (const p of problemas) {
    if (!(await reclamarVentana(`vigia:${p.job}`, p.clave))) continue;
    avisados += 1;
    log.error(`[vigia] ${p.job}: ${p.detalle}`);
    for (const tenantId of await tenantsActivos())
      await notificar(
        { tenantId },
        {
          tipo: 'job_sin_correr',
          titulo: `Tarea programada sin correr: ${p.descripcion}`,
          cuerpo: `${p.detalle}\nRevisa los logs de Railway o la sección de tareas programadas en Admin → Servicios.`,
          ruta: '/admin/servicios',
        },
        { roles: ['admin'] },
      ).catch((e) => log.error('[vigia] aviso no enviado', e));
  }
  return { problemas: problemas.length, avisados };
}
