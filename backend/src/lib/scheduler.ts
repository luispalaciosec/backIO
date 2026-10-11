/**
 * Scheduler interno para despliegues como proceso persistente (Railway, Docker). Se activa con ENABLE_INTERNAL_CRON=1
 * (lo fija el Dockerfile). Cada minuto recorre JOBS (lib/jobs.ts): ahí están los horarios y qué corre.
 */
import { JOBS, ejecutarJob, momentoLocal } from './jobs';

export function startScheduler(): void {
  if (process.env.ENABLE_INTERNAL_CRON !== '1') return;
  console.log(`[scheduler] activo: ${JOBS.map((j) => j.nombre).join(', ')}`);

  // Candado en memoria: una corrida larga (muchos clientes) no se solapa con la siguiente; el solape duplicaba
  // proyectos. Entre procesos el candado es la fila única de cron_runs.
  const enCurso = new Set<string>();
  const tick = () => {
    const m = momentoLocal();
    for (const job of JOBS) {
      if (enCurso.has(job.nombre)) continue;
      enCurso.add(job.nombre);
      // ejecutarJob no lanza; el catch es por si algo falla antes (p. ej. un bug al calcular la ventana).
      ejecutarJob(job, m)
        .catch((err) => console.error(`[scheduler] ${job.nombre}`, err instanceof Error ? err.message : err))
        .finally(() => enCurso.delete(job.nombre));
    }
  };
  setInterval(tick, 60_000);
  // Primer tick a los 30 s: recupera lo que tocaba durante el despliegue sin competir con el arranque.
  setTimeout(tick, 30_000);
}
