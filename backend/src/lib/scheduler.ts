/**
 * Scheduler interno para despliegues como proceso persistente (Railway, Render, Docker).
 * Se activa con ENABLE_INTERNAL_CRON=1. En Vercel se usan los endpoints /api/cron con Vercel Cron.
 *  - Reconciliación Basecamp: cada 30 minutos.
 *  - Señales del weekly: domingo 18:00 America/Guayaquil (se evalúa cada minuto, corre una vez).
 */
import { serviceClient, throwIf } from './db';
import { reconcileTenant } from './basecamp/reconcile';
import { recalcularSenales } from './rituals/service';

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

  let ultimaCorrida = '';
  setInterval(async () => {
    const t = ahoraLocal();
    if (t.dia === 0 && t.hora === 18 && t.minuto === 0 && ultimaCorrida !== t.clave) {
      ultimaCorrida = t.clave;
      for (const id of await tenants()) {
        try {
          const s = await recalcularSenales({ db: serviceClient(), tenantId: id, usuarioId: null, origen: 'cron' });
          console.log(`[scheduler] señales ${id}: ${s.length}`);
        } catch (err) {
          console.error('[scheduler] señales fallaron', id, err instanceof Error ? err.message : err);
        }
      }
    }
  }, 60_000);
}
