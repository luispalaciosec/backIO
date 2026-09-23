import type { DailyView, Usuario, Mesa } from '@backio/shared';
import { DailyPublicar } from './DailyPublicar';
import { SeleccionDaily } from './SeleccionDaily';
import { MesaPaso } from './MesaPaso';
import { apiServer } from '@/lib/api.server';
import { meServer, puedeEscribir } from '@/lib/me.server';
import { fecha } from '@/lib/format';
import { EstadoChip } from '@/components/ui/EstadoChip';

export const dynamic = 'force-dynamic';

/**
 * Daily: construcción secuencial. 1) mesa → 2) qué se trabaja hoy (solo tareas de la mesa)
 * → 3) tablero de la mesa → 4) apertura/cierre publicado en el board Daily de la mesa.
 * Una sola pantalla, sin scroll, proyectable. El daily no prioriza, desbloquea.
 */
export default async function DailyPage({ searchParams }: { searchParams: { mesa?: string } }) {
  const [{ items: usuarios }, { items: mesas }, me] = await Promise.all([apiServer<{ items: Usuario[] }>('/usuarios'), apiServer<{ items: Mesa[] }>('/mesas'), meServer()]);
  const activas = mesas.filter((m) => m.activa);
  const todas = searchParams.mesa === 'todas';
  const mesa = !todas && searchParams.mesa && activas.some((m) => m.id === searchParams.mesa) ? activas.find((m) => m.id === searchParams.mesa)! : null;
  const elegida = !!mesa || todas;
  const d = elegida ? await apiServer<DailyView>(`/semanas/daily${mesa ? `?mesa=${mesa.id}` : ''}`) : null;
  const nombre = (id?: string) => usuarios.find((u) => u.id === id)?.nombre ?? '—';
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const escribe = puedeEscribir(me.rol);
  const mesaNombre = mesa?.nombre ?? 'Toda la agencia';
  // Regla del daily: ninguna tarea entra sin responsable. Se avisa aquí y el backend bloquea la publicación.
  const sinResponsable = d ? [...new Map([...d.hoy_se_trabaja, ...d.vencen_hoy_o_manana_sin_iniciar, ...d.bloqueos_nuevos, ...d.fechas_cambiadas].filter((r) => r.owner_agencia.length === 0).map((r) => [r.id, r])).values()] : [];
  const Col = ({ titulo, items, vacio }: { titulo: string; items: DailyView['bloqueos_nuevos']; vacio: string }) => (
    <section className="card flex flex-col min-h-0">
      <div className="px-4 py-3 border-b border-gray-200 font-semibold flex justify-between"><span>{titulo}</span><span className="text-gray-400">{items.length}</span></div>
      <ul className="p-3 space-y-2 overflow-auto">
        {items.length === 0 && <li className="text-sm text-gray-400">{vacio}</li>}
        {items.map((r) => (
          <li key={r.id} className="rounded-md border border-gray-200 p-3 text-sm">
            <div className="font-medium">{r.titulo_interno}</div>
            <div className="text-xs text-gray-500 flex justify-between mt-1"><span className={r.owner_agencia.length === 0 ? 'text-red-700 font-semibold' : ''}>{r.owner_agencia.length === 0 ? '⚠ Sin responsable' : nombre(r.owner_agencia[0])}</span><span>{fecha(r.fecha_entrega)}</span></div>
            <div className="mt-1"><EstadoChip estado={r.estado_operativo} /></div>
          </li>
        ))}
      </ul>
    </section>
  );
  const Paso = ({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) => (
    <div className="flex items-center gap-2">
      <span className="h-6 w-6 rounded-full bg-brand text-white text-xs font-bold flex items-center justify-center shrink-0">{n}</span>
      <span className="text-xs uppercase tracking-wide text-gray-500 whitespace-nowrap">{titulo}</span>
      {children}
    </div>
  );
  return (
    <div className="h-[calc(100vh-3rem)] flex flex-col gap-4">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold">Daily · {new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}{elegida && <span className="text-gray-400 font-normal"> · {mesaNombre}</span>}</h1>
        {elegida && (
          <div className="flex items-center gap-5 flex-wrap">
            <Paso n={1} titulo="Mesa"><MesaPaso mesas={activas.map((m) => ({ id: m.id, nombre: m.nombre }))} mesa={mesa?.id ?? ''} todas={todas} /></Paso>
            {escribe && <Paso n={2} titulo="Hoy"><SeleccionDaily hoy={hoy} mesa={mesa?.id ?? ''} mesaNombre={mesaNombre} seleccionadasHoy={d?.hoy_se_trabaja.length ?? 0} /></Paso>}
          </div>
        )}
      </header>
      {!elegida && <MesaPaso mesas={activas.map((m) => ({ id: m.id, nombre: m.nombre }))} mesa="" todas={false} />}
      {elegida && d && (
        <>
          {sinResponsable.length > 0 && (
            <div className="rounded-md border border-red-300 bg-red-50 text-red-900 px-4 py-3 text-sm flex items-start gap-3">
              <span className="text-lg leading-none">⚠</span>
              <div className="flex-1">
                <div className="font-semibold">{sinResponsable.length === 1 ? 'Hay una tarea sin responsable en este daily.' : `Hay ${sinResponsable.length} tareas sin responsable en este daily.`} No se puede publicar hasta asignar a alguien.</div>
                <ul className="mt-1 list-disc pl-5">{sinResponsable.map((r) => <li key={r.id}>{r.titulo_interno}</li>)}</ul>
              </div>
              <a className="btn-primary text-xs py-1 shrink-0" href={`/backlog${mesa ? `?mesa=${mesa.id}` : ''}`}>Asignar en el backlog</a>
            </div>
          )}
          <div className="grid grid-cols-4 gap-4 flex-1 min-h-0">
            <Col titulo="🎯 Hoy se trabaja" items={d.hoy_se_trabaja} vacio={`Nadie eligió tareas de ${mesaNombre} para hoy. Usa «Elegir tareas de hoy» o ☀ en el backlog.`} />
            <Col titulo="Vence hoy o mañana sin iniciar" items={d.vencen_hoy_o_manana_sin_iniciar} vacio="Nada vence sin iniciar." />
            <Col titulo="Bloqueos nuevos (24h)" items={d.bloqueos_nuevos} vacio="Sin bloqueos nuevos." />
            <Col titulo="Fechas cambiadas desde ayer" items={d.fechas_cambiadas} vacio="Sin cambios de fecha." />
          </div>
          <footer className="card p-3">
            {escribe ? (
              <Paso n={3} titulo="Publicar"><DailyPublicar mesa={mesa?.id ?? ''} mesaNombre={mesaNombre} tieneBoard={!!mesa?.basecamp_board_daily_id} /></Paso>
            ) : <span className="text-xs text-gray-400">Solo lectura · la apertura y el cierre los publica quien lleva la mesa</span>}
          </footer>
        </>
      )}
    </div>
  );
}
