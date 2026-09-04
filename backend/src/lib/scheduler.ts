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
import { detectarHuerfanos } from './basecamp/huerfanos';
import { iaDisponible } from './ia';
import { generarInformeMensual } from './ia/informe';
import { listMesas } from './db/mesas';
import { procesarRecurrencias } from './recurrencias';
import { sincronizarHoras } from './horas';

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

  const reconciliar = async () => {
    for (const t of await tenants()) {
      try {
        const r = await reconcileTenant({ db: serviceClient(), tenantId: t, usuarioId: null, origen: 'cron' });
        if (r.aplicados) console.log(`[scheduler] reconcile ${t}: ${r.aplicados}/${r.revisados}`);
      } catch (err) {
        console.error('[scheduler] reconcile falló', t, err instanceof Error ? err.message : err);
      }
    }
  };
  setInterval(() => void reconciliar(), 30 * 60_000);
  // Huérfanos cada 30 min (desfasado 10 min de la reconciliación) y horas cada 6 h.
  setTimeout(() => setInterval(async () => { for (const t of await tenants()) await detectarHuerfanos({ db: serviceClient(), tenantId: t, usuarioId: null, origen: 'cron' }).catch((e: Error) => console.error('[scheduler] huerfanos', e.message)); }, 30 * 60_000), 10 * 60_000);
  setInterval(async () => { for (const t of await tenants()) await sincronizarHoras({ db: serviceClient(), tenantId: t, usuarioId: null, origen: 'cron' }).catch((e: Error) => console.error('[scheduler] horas', e.message)); }, 6 * 3600_000);

  setInterval(() => void procesarPendientes().catch(() => undefined), 60_000);

  let ultimaCorrida = '';
  let ultimoInforme = '';
  let ultimaRecurrencia = '';
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
