import type { DailyView, Usuario, Mesa } from '@backio/shared';
import { DailyPublicar } from './DailyPublicar';
import { SeleccionDaily } from './SeleccionDaily';
import { apiServer } from '@/lib/api.server';
import { meServer, puedeEscribir } from '@/lib/me.server';
import { fecha } from '@/lib/format';
import { EstadoChip } from '@/components/ui/EstadoChip';

export const dynamic = 'force-dynamic';

/** Daily: una sola pantalla, sin scroll, proyectable. El daily no prioriza, desbloquea. */
export default async function DailyPage() {
  const [d, { items: usuarios }, { items: mesas }, me] = await Promise.all([apiServer<DailyView>('/semanas/daily'), apiServer<{ items: Usuario[] }>('/usuarios'), apiServer<{ items: Mesa[] }>('/mesas'), meServer()]);
  const nombre = (id?: string) => usuarios.find((u) => u.id === id)?.nombre ?? '—';
  const Col = ({ titulo, items, vacio }: { titulo: string; items: DailyView['bloqueos_nuevos']; vacio: string }) => (
    <section className="card flex flex-col min-h-0">
      <div className="px-4 py-3 border-b border-gray-200 font-semibold flex justify-between"><span>{titulo}</span><span className="text-gray-400">{items.length}</span></div>
      <ul className="p-3 space-y-2 overflow-auto">
        {items.length === 0 && <li className="text-sm text-gray-400">{vacio}</li>}
        {items.map((r) => (
          <li key={r.id} className="rounded-md border border-gray-200 p-3 text-sm">
            <div className="font-medium">{r.titulo_interno}</div>
            <div className="text-xs text-gray-500 flex justify-between mt-1"><span>{nombre(r.owner_agencia[0])}</span><span>{fecha(r.fecha_entrega)}</span></div>
            <div className="mt-1"><EstadoChip estado={r.estado_operativo} /></div>
          </li>
        ))}
      </ul>
    </section>
  );
  return (
    <div className="h-[calc(100vh-3rem)] flex flex-col gap-4">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold">Daily · {new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</h1>
        {puedeEscribir(me.rol) && <SeleccionDaily hoy={new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())} mesas={mesas.filter((m) => m.activa).map((m) => ({ id: m.id, nombre: m.nombre }))} />}
        {puedeEscribir(me.rol) ? <DailyPublicar mesas={mesas.filter((m) => m.activa && m.basecamp_board_daily_id).map((m) => ({ id: m.id, nombre: m.nombre }))} /> : <span className="text-xs text-gray-400">Solo lectura · la apertura y el cierre los publica quien lleva la mesa</span>}
      </header>
      <div className="grid grid-cols-4 gap-4 flex-1 min-h-0">
        <Col titulo="🎯 Hoy se trabaja" items={d.hoy_se_trabaja} vacio="Nadie eligió tareas para hoy. Usa «Elegir tareas de hoy» o ☀ en el backlog." />
        <Col titulo="Vence hoy o mañana sin iniciar" items={d.vencen_hoy_o_manana_sin_iniciar} vacio="Nada vence sin iniciar." />
        <Col titulo="Bloqueos nuevos (24h)" items={d.bloqueos_nuevos} vacio="Sin bloqueos nuevos." />
        <Col titulo="Fechas cambiadas desde ayer" items={d.fechas_cambiadas} vacio="Sin cambios de fecha." />
      </div>
    </div>
  );
}
