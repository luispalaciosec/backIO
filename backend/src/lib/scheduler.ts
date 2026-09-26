/**
 * Scheduler interno para despliegues como proceso persistente (Railway, Render, Docker).
 * Se activa con ENABLE_INTERNAL_CRON=1. En Vercel se usan los endpoints /api/cron con Vercel Cron.
 *  - Reconciliación Basecamp: cada 30 minutos.
 *  - Señales del weekly: domingo 18:00 America/Guayaquil (se evalúa cada minuto, corre una vez).
 */
import { serviceClient, throwIf } from './db';
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

const TZ = 'America/Guayaquil';

function ahoraLocal(): { dia: number; hora: number; minuto: number; clave: string } {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = Object.fromEntries(f.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const dias = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>;
  return { dia: dias[parts.weekday ?? 'Mon'] ?? 1, hora: Number(parts.hour), minuto: Number(parts.minute), clave: `${parts.year}-${parts.month}-${parts.day}` };
}

async function tenants(): Promise<string[]> {
  const { data, error } = await serviceClient().from('tenants').select('id').eq('activo', true);
  throwIf(error);
  return (data ?? []).map((t) => (t as { id: string }).id);
}

export function startScheduler(): void {
  if (process.env.ENABLE_INTERNAL_CRON !== '1') return;
  console.log('[scheduler] activo: reconciliación cada 30 min · señales domingo 18:00 Guayaquil');

  // Lock por job: una corrida larga (muchos clientes) no debe solaparse con la siguiente; el solape duplicaba proyectos.
  const enCurso = new Set<string>();
  const exclusivo = (nombre: string, fn: () => Promise<void>) => async () => {
    if (enCurso.has(nombre)) { console.warn(`[scheduler] ${nombre} sigue en curso; se omite esta corrida`); return; }
    enCurso.add(nombre);
    try { await fn(); } finally { enCurso.delete(nombre); }
  };
  const reconciliar = exclusivo('reconcile', async () => {
    for (const t of await tenants()) {
      try {
        const r = await reconcileTenant({ db: serviceClient(), tenantId: t, usuarioId: null, origen: 'cron' });
        if (r.aplicados) console.log(`[scheduler] reconcile ${t}: ${r.aplicados}/${r.revisados}`);
      } catch (err) {
        console.error('[scheduler] reconcile falló', t, err instanceof Error ? err.message : err);
      }
    }
  });
  setInterval(() => void reconciliar(), 30 * 60_000);
  // Estructura de Basecamp cada 15 min como red de seguridad (el webhook todo_created ya trae lo nuevo en segundos):
  // to-dos nuevos → requerimientos, renombres, movimientos, responsables y eliminados. Basecamp es origen aceptado
  // (23/09/2026), así que el detector de huérfanos ya no corre por cron: lo creado a mano entra solo.
  const estructura = exclusivo('estructura', async () => {
    for (const t of await tenants()) {
      const ctx = { db: serviceClient(), tenantId: t, usuarioId: null, origen: 'cron' as const };
      const { data } = await serviceClient().from('clientes').select('id, nombre').eq('tenant_id', t).eq('activo', true).not('basecamp_project_id', 'is', null);
      for (const c of (data ?? []) as { id: string; nombre: string }[]) {
        try { const r = await importarBasecampCliente(ctx, c.id); if (r.requerimientos_creados || r.proyectos_creados || r.titulos_actualizados || r.movidos || r.proyectos_renombrados || r.eliminados_en_basecamp || r.responsables_actualizados) console.log('[scheduler] estructura', c.nombre, JSON.stringify(r)); }
        catch (e) { console.error('[scheduler] estructura', c.nombre, e instanceof Error ? e.message : e); }
      }
    }
  });
  setTimeout(() => setInterval(() => void estructura(), 15 * 60_000), 10 * 60_000);
  // Horas cada 6 h.
  const horas = exclusivo('horas', async () => { for (const t of await tenants()) await sincronizarHoras({ db: serviceClient(), tenantId: t, usuarioId: null, origen: 'cron' }).catch((e: Error) => console.error('[scheduler] horas', e.message)); });
  setInterval(() => void horas(), 6 * 3600_000);

  setInterval(() => void procesarPendientes().catch(() => undefined), 60_000);

  let ultimaCorrida = '';
  let ultimoInforme = '';
  let ultimaRecurrencia = '';
  let ultimoKpi = '';
  let ultimaFotoDia = '';
  let ultimaFotoSemana = '';
  setInterval(async () => {
    const t = ahoraLocal();
    // Diario 08:05: recurrencias de fees (genera el mes siguiente cuando llega el día configurado).
    if (t.hora === 8 && t.minuto === 5 && ultimaRecurrencia !== t.clave) {
      ultimaRecurrencia = t.clave;
      for (const id of await tenants()) {
        try { const r = await procesarRecurrencias({ db: serviceClient(), tenantId: id, usuarioId: null, origen: 'cron' }); if (r.generadas.length || r.errores.length) console.log('[scheduler] recurrencias', JSON.stringify(r)); }
        catch (err) { console.error('[scheduler] recurrencias', err instanceof Error ? err.message : err); }
      }
    }
    // Evolutivo: L-V 19:30 foto del día de cada mesa (el cierre publicado ya la deja; esto cubre los días sin cierre).
    if (t.dia >= 1 && t.dia <= 5 && t.hora === 19 && t.minuto === 30 && ultimaFotoDia !== t.clave) {
      ultimaFotoDia = t.clave;
      for (const id of await tenants()) {
        const ctx = { db: serviceClient(), tenantId: id, usuarioId: null, origen: 'cron' as const };
        for (const mesa of (await listMesas(ctx)).filter((m) => m.activa)) {
          try { await fotoDaily(ctx, mesa, t.clave, 'cron'); } catch (err) { console.error('[scheduler] foto daily', mesa.nombre, err instanceof Error ? err.message : err); }
        }
      }
    }
    // Evolutivo: domingo 17:55, antes de recalcular señales, foto de la semana que cierra.
    if (t.dia === 0 && t.hora === 17 && t.minuto === 55 && ultimaFotoSemana !== t.clave) {
      ultimaFotoSemana = t.clave;
      for (const id of await tenants()) {
        try { const n = await fotoWeekly({ db: serviceClient(), tenantId: id, usuarioId: null, origen: 'cron' }, t.clave); console.log(`[scheduler] foto semanal: ${n} mesas`); }
        catch (err) { console.error('[scheduler] foto semanal', err instanceof Error ? err.message : err); }
      }
    }
    // Día 1 08:10: congela los KPIs automáticos del mes anterior (y del trimestre si cerró). No pisa ajustes.
    if (t.hora === 8 && t.minuto === 10 && t.clave.endsWith('-01') && ultimoKpi !== t.clave) {
      ultimoKpi = t.clave;
      const [y, m] = t.clave.split('-').map(Number);
      const prev = new Date(Date.UTC(y!, (m ?? 1) - 2, 1));
      const mes = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
      const periodos = [mes, ...((m ?? 1) % 3 === 1 ? [trimestreDe(mes)] : [])];
      for (const id of await tenants()) for (const p of periodos) {
        try { const n = await congelarPeriodo({ db: serviceClient(), tenantId: id, usuarioId: null, origen: 'cron' }, p); console.log(`[scheduler] KPIs ${p} congelados: ${n}`); }
        catch (err) { console.error('[scheduler] KPIs', p, err instanceof Error ? err.message : err); }
      }
    }
    // Día 1 de cada mes 08:00: informe ejecutivo del mes anterior por mesa (solo se redacta; Marcia lo publica).
    if (t.hora === 8 && t.minuto === 0 && t.clave.endsWith('-01') && ultimoInforme !== t.clave && iaDisponible()) {
      ultimoInforme = t.clave;
      const [y, m] = t.clave.split('-').map(Number);
      const prev = new Date(Date.UTC(y!, (m ?? 1) - 2, 1));
      const mes = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
      for (const id of await tenants()) {
        const ctx = { db: serviceClient(), tenantId: id, usuarioId: null, origen: 'cron' as const };
        for (const mesa of (await listMesas(ctx)).filter((x) => x.activa)) {
          try {
            await generarInformeMensual(ctx, mesa.id, mes);
            await notificar({ tenantId: id }, { tipo: 'informe_mensual', titulo: `Informe mensual ${mes} · ${mesa.nombre} listo para revisar`, cuerpo: 'BackIO redactó el informe ejecutivo del mes. Revísalo y publícalo en Basecamp desde Informes.', ruta: '/informes' }, { roles: ['operaciones', 'admin'] });
          } catch (err) { console.error('[scheduler] informe mensual', mesa.nombre, err instanceof Error ? err.message : err); }
        }
      }
    }
    if (t.dia === 0 && t.hora === 18 && t.minuto === 0 && ultimaCorrida !== t.clave) {
      ultimaCorrida = t.clave;
      for (const id of await tenants()) {
        try {
          const s = await recalcularSenales({ db: serviceClient(), tenantId: id, usuarioId: null, origen: 'cron' });
          console.log(`[scheduler] señales ${id}: ${s.length}`);
          const criticas = s.filter((x) => x.severidad === 'critica');
          const lineas = s.slice(0, 15).map((x) => `• [${x.severidad.toUpperCase()}] ${x.titulo} → ${temaAgenda(x.tipo)}`);
          await notificar({ tenantId: id }, {
            tipo: 'agenda_weekly',
            titulo: `Agenda del weekly: ${s.length} señales (${criticas.length} críticas)`,
            cuerpo: lineas.length ? lineas.join('\n') : 'Sin señales esta semana.',
            ruta: '/weekly',
          }, { roles: ['operaciones', 'admin'] });
        } catch (err) {
          console.error('[scheduler] señales fallaron', id, err instanceof Error ? err.message : err);
        }
      }
    }
  }, 60_000);
}
