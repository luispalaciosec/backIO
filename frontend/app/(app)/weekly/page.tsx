import type { Semana, Senal, Acuerdo, Usuario, CapacidadPersona, Mesa } from '@backio/shared';
import { apiServer } from '@/lib/api.server';
import { fecha } from '@/lib/format';
import { WeeklyActions, AcuerdoForm } from './WeeklyActions';
import { meServer, puedeEscribir } from '@/lib/me.server';

export const dynamic = 'force-dynamic';

const SEV: Record<string, string> = { critica: 'bg-red-100 text-red-800', alta: 'bg-amber-100 text-amber-800', media: 'bg-gray-100 text-gray-700' };

export default async function WeeklyPage() {
  const [semana, me] = await Promise.all([apiServer<Semana>('/semanas/actual'), meServer()]);
  const escribe = puedeEscribir(me.rol);
  const [{ items: senales }, { items: acuerdos }, { items: abiertos }, { items: capacidad }, { items: usuarios }, { items: mesas }] = await Promise.all([
    apiServer<{ items: Senal[] }>(`/semanas/${semana.id}/senales`),
    apiServer<{ items: Acuerdo[] }>(`/semanas/${semana.id}/acuerdos`),
    apiServer<{ items: Acuerdo[] }>('/semanas/acuerdos/abiertos'),
    apiServer<{ items: CapacidadPersona[] }>(`/semanas/${semana.id}/capacidad`),
    apiServer<{ items: Usuario[] }>('/usuarios'),
    apiServer<{ items: Mesa[] }>('/mesas'),
  ]);
  const dash = await apiServer<{ arrastre: { requerimiento_id: string; titulo: string; cliente: string; owner: string | null; veces_reprogramado: number; fecha_original: string | null; fecha_actual: string | null; dias_arrastre: number }[] }>('/dashboard');
  const nombre = (id: string) => usuarios.find((u) => u.id === id)?.nombre ?? '—';
  const hoy = new Date().toISOString().slice(0, 10);
  const vencidos = abiertos.filter((a) => a.fecha_compromiso < hoy);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Weekly · Semana {semana.numero_iso}</h1>
          <p className="text-sm text-gray-500">{fecha(semana.fecha_inicio)} – {fecha(semana.fecha_fin)} · agenda generada por el motor de señales</p>
        </div>
        {escribe ? <WeeklyActions semanaId={semana.id} mesas={mesas.filter((m) => m.activa).map((m) => ({ id: m.id, nombre: m.nombre }))} /> : <span className="text-xs text-gray-400">Solo lectura · los documentos los genera operaciones</span>}
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section className="card">
            <div className="px-4 py-3 border-b border-gray-200 font-semibold">1. Compromisos vencidos ({vencidos.length})</div>
            <ul className="divide-y divide-gray-100">
              {vencidos.length === 0 && <li className="p-4 text-sm text-gray-400">Sin compromisos vencidos.</li>}
              {vencidos.map((a) => (
                <li key={a.id} className="p-4 text-sm flex justify-between gap-3"><span>{a.descripcion}</span><span className="text-red-700 whitespace-nowrap">{nombre(a.responsable_id)} · {fecha(a.fecha_compromiso)}</span></li>
              ))}
            </ul>
          </section>

          <section className="card">
            <div className="px-4 py-3 border-b border-gray-200 font-semibold">2. Señales ({senales.length})</div>
            <ul className="divide-y divide-gray-100">
              {senales.length === 0 && <li className="p-4 text-sm text-gray-400">Sin señales. Recalcula para generar la agenda.</li>}
              {senales.map((s) => (
                <li key={s.id} className={`p-4 text-sm flex items-start gap-3 ${s.atendida ? 'opacity-50' : ''}`}>
                  <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${SEV[s.severidad]}`}>{s.severidad}</span>
                  <div className="flex-1"><div>{s.titulo}</div><div className="text-xs text-gray-500">{s.tipo.replace(/_/g, ' ')}</div></div>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <div className="px-4 py-3 border-b border-gray-200 font-semibold flex justify-between"><span>3. Arrastre ({dash.arrastre.length})</span><span className="text-xs font-normal text-gray-500">se hace, se reasigna o se mata</span></div>
            <ul className="divide-y divide-gray-100">
              {dash.arrastre.length === 0 && <li className="p-4 text-sm text-gray-400">Sin arrastre.</li>}
              {dash.arrastre.slice(0, 15).map((a) => (
                <li key={a.requerimiento_id} className="p-3 text-sm flex items-center justify-between gap-3">
                  <div><div>{a.titulo}</div><div className="text-xs text-gray-500">{a.cliente} · {a.owner ?? 'sin owner'} · {fecha(a.fecha_original)} → {fecha(a.fecha_actual)}</div></div>
                  <div className="text-right whitespace-nowrap"><div className={`font-semibold ${a.veces_reprogramado >= 2 ? 'text-red-600' : 'text-amber-600'}`}>{a.veces_reprogramado}× reprog.</div><div className="text-xs text-gray-500">{a.dias_arrastre} días</div></div>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <div className="px-4 py-3 border-b border-gray-200 font-semibold">4. Capacidad (calculada, no declarada)</div>
            <table className="w-full"><thead><tr><th className="th">Persona</th><th className="th text-right">Tareas</th><th className="th text-right">% total</th><th className="th text-right">Capacidad h</th></tr></thead>
              <tbody>{capacidad.map((c) => (
                <tr key={c.usuario_id}><td className="td">{c.nombre}</td><td className="td text-right">{c.tareas}</td><td className={`td text-right ${c.pct_del_total > 30 ? 'text-red-600 font-semibold' : ''}`}>{c.pct_del_total}%</td><td className="td text-right">{c.capacidad_semanal}</td></tr>
              ))}{capacidad.length === 0 && <tr><td className="td text-gray-400" colSpan={4}>Sin tareas esta semana.</td></tr>}</tbody></table>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="card p-4 space-y-3">
            <div className="font-semibold">Acuerdos de la sesión</div>
            <p className="text-xs text-gray-500">Tres campos. La fecha es real: no existe “próxima weekly”.</p>
            {escribe ? <AcuerdoForm semanaId={semana.id} usuarios={usuarios.map((u) => ({ id: u.id, nombre: u.nombre }))} /> : <p className="text-xs text-gray-400">Los acuerdos los registra quien dirige el weekly.</p>}
            <ul className="divide-y divide-gray-100 text-sm">
              {acuerdos.map((a) => (
                <li key={a.id} className="py-2"><div>{a.descripcion}</div><div className="text-xs text-gray-500">{nombre(a.responsable_id)} · {fecha(a.fecha_compromiso)} · {a.estado}</div></li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
