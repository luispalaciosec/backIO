import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { FichaCliente, PersonaFicha, TareaFicha } from '@backio/shared';
import { diaLocal } from '@backio/shared';
import { apiServer } from '@/lib/api.server';
import { ApiError } from '@/lib/api';
import { meServer, puedeEscribir } from '@/lib/me.server';
import { fecha } from '@/lib/format';
import { hrefExterno } from '@/lib/url';
import { Avatar } from '@/components/kpis/comun';
import { COLOR_SALUD } from '@/components/dashboard/Charts';
import { AvanceBar } from '@/components/ui/AvanceBar';
import { EstadoChip } from '@/components/ui/EstadoChip';
import { Sugerencias } from './Sugerencias';

export const dynamic = 'force-dynamic';

const SALUD_TEXTO = { verde: 'Sana', amarillo: 'En observación', rojo: 'En riesgo' } as const;
const SEV: Record<string, string> = {
  critica: 'bg-red-100 text-red-800',
  alta: 'bg-amber-100 text-amber-800',
  media: 'bg-gray-100 text-gray-700',
};
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const pct = (n: number | null) => (n === null ? '—' : `${n} %`);

function Persona({ rol, p }: { rol: string; p: PersonaFicha | null }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      {p ? (
        <Avatar nombre={p.nombre} url={p.avatar_url} size={44} />
      ) : (
        <span className="w-11 h-11 rounded-full border border-dashed border-gray-300" />
      )}
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-gray-500">{rol}</div>
        <div className="font-medium truncate">{p?.nombre ?? 'Sin asignar'}</div>
        {p?.email && <div className="text-xs text-gray-500 truncate">{p.email}</div>}
      </div>
    </div>
  );
}

function Indicador({ etiqueta, valor, sub, alerta }: { etiqueta: string; valor: string | number; sub?: string; alerta?: boolean }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{etiqueta}</div>
      <div className={`text-3xl font-bold tabular-nums mt-1 ${alerta ? 'text-red-600' : ''}`}>{valor}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

/** Entregas por mes (barras) con el % a tiempo encima. */
function Mensual({ serie }: { serie: FichaCliente['mensual'] }) {
  const max = Math.max(1, ...serie.map((m) => m.entregas));
  return (
    <div className="grid grid-cols-6 gap-2 items-end h-36">
      {serie.map((m) => {
        const [, mm] = m.mes.split('-');
        const color =
          m.pct_a_tiempo === null
            ? '#d1d5db'
            : m.pct_a_tiempo >= 80
              ? COLOR_SALUD.verde
              : m.pct_a_tiempo >= 60
                ? COLOR_SALUD.amarillo
                : COLOR_SALUD.rojo;
        return (
          <div
            key={m.mes}
            className="flex flex-col items-center gap-1 h-full justify-end"
            title={`${m.entregas} entregas · ${pct(m.pct_a_tiempo)} a tiempo · ${m.reprocesos} reprocesos`}
          >
            <span className="text-[11px] tabular-nums text-gray-600">{pct(m.pct_a_tiempo)}</span>
            <div className="w-full rounded-t" style={{ height: `${(m.entregas / max) * 70}%`, minHeight: 2, backgroundColor: color }} />
            <span className="text-[11px] text-gray-500">
              {MES[Number(mm) - 1]} · {m.entregas}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ListaTareas({
  titulo,
  items,
  vacio,
  detalle,
}: {
  titulo: string;
  items: TareaFicha[];
  vacio: string;
  detalle: (t: TareaFicha) => string;
}) {
  return (
    <section className="card flex flex-col min-h-0">
      <div className="px-4 py-3 border-b border-gray-200 font-semibold flex justify-between">
        <span>{titulo}</span>
        <span className="text-gray-400 tabular-nums">{items.length}</span>
      </div>
      <ul className="divide-y divide-gray-100 max-h-80 overflow-auto">
        {items.length === 0 && <li className="p-4 text-sm text-gray-400">{vacio}</li>}
        {items.map((t) => (
          <li key={t.id} className="px-4 py-2.5 text-sm">
            <div className="flex items-start justify-between gap-3">
              {t.basecamp_url ? (
                <a href={hrefExterno(t.basecamp_url)} target="_blank" rel="noreferrer" className="font-medium hover:underline break-words">
                  {t.titulo_interno}
                </a>
              ) : (
                <span className="font-medium break-words">{t.titulo_interno}</span>
              )}
              <span className="text-xs text-gray-500 shrink-0 tabular-nums">{detalle(t)}</span>
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              {[t.proyecto, t.responsables.join(', ') || 'Sin responsable'].filter(Boolean).join(' · ')}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Ficha del cliente (docs/21): quién lo lleva, cómo está y qué hacer. */
export default async function FichaClientePage({ params: pP }: { params: Promise<{ id: string }> }) {
  const { id } = await pP;
  const me = await meServer();
  if (!puedeEscribir(me.rol)) return <p className="text-sm text-gray-500">La ficha del cliente es para el equipo de gestión.</p>;
  let f: FichaCliente;
  try {
    f = await apiServer<FichaCliente>(`/clientes/${id}/ficha`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const i = f.indicadores;
  const enCurso = f.proyectos.filter((p) => !['completado', 'cancelado'].includes(p.estado));
  const cerrados = f.proyectos.length - enCurso.length;
  const color = f.cliente.color_primario ?? '#0073EA';

  return (
    <div className="space-y-5">
      <header className="card overflow-hidden">
        <div className="h-1.5" style={{ backgroundColor: color }} />
        <div className="p-5 grid gap-5 lg:grid-cols-[1.4fr_1fr_1fr] items-center">
          <div className="flex items-center gap-4 min-w-0">
            {f.cliente.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={f.cliente.logo_url} alt="" className="w-14 h-14 rounded-lg object-contain border border-gray-200 bg-white" />
            ) : (
              <span
                className="w-14 h-14 rounded-lg flex items-center justify-center text-xl font-bold text-white"
                style={{ backgroundColor: color }}
              >
                {f.cliente.nombre.slice(0, 1)}
              </span>
            )}
            <div className="min-w-0">
              <h1 className="text-2xl font-bold truncate">{f.cliente.nombre}</h1>
              <div className="flex items-center gap-2 mt-1 text-sm">
                <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: COLOR_SALUD[f.salud.salud] }} />
                <span className="font-medium">{SALUD_TEXTO[f.salud.salud]}</span>
                {f.salud.motivos.length > 0 && <span className="text-gray-500">· {f.salud.motivos.join(' · ')}</span>}
              </div>
            </div>
          </div>
          <Persona rol="Ejecutiva de cuenta" p={f.ejecutiva} />
          <Persona rol={f.mesa ? `${f.mesa.nombre} · líder` : 'Sin mesa'} p={f.mesa?.lider ?? null} />
        </div>
        <div className="px-5 pb-4 flex flex-wrap gap-3 text-sm">
          <Link className="link-action" href={`/backlog?cliente=${f.cliente.id}`}>
            Ver en el backlog
          </Link>
          <Link className="link-action" href={`/informes/estatus?cliente=${f.cliente.id}`}>
            Estatus para el cliente
          </Link>
          {me.rol === 'admin' && (
            <Link className="link-action" href="/admin/clientes">
              Cambiar ejecutiva o mesa
            </Link>
          )}
        </div>
      </header>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Indicador
          etiqueta="A tiempo · 90 días"
          valor={pct(i.pct_a_tiempo_90d)}
          sub={`${i.entregas_medidas_90d} de ${i.entregas_90d} entregas medidas (pedidas desde el 21/09) · fecha vigente ${pct(i.pct_a_tiempo_vigente_90d)}${i.desvio_mediana_dias ? ` · ${i.desvio_mediana_dias} d de desvío` : ''}`}
        />
        <Indicador
          etiqueta="Atrasadas"
          valor={i.atrasados}
          alerta={i.atrasados > 0}
          sub={`${i.activos} activas · ${i.esperando_cliente} esperando al cliente · ${i.bloqueadas} bloqueadas`}
        />
        <Indicador
          etiqueta="Reprocesos · 90 días"
          valor={i.reprocesos_90d}
          sub={`${i.reprocesos_equipo_90d} nuestros${i.motivo_reproceso_dominante ? ` · sobre todo ${i.motivo_reproceso_dominante.toLowerCase()}` : ''}`}
        />
        <Indicador
          etiqueta="Horas · 30 días"
          valor={i.horas_30d}
          sub={`${i.reprogramaciones_90d} reprogramaciones en 90 d (${i.reprogramaciones_cliente_90d} por el cliente)`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <section className="card p-4 space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="font-semibold">Entregas por mes</span>
            <span className="text-xs text-gray-500">% a tiempo según la fecha original</span>
          </div>
          <Mensual serie={f.mensual} />
        </section>
        <Sugerencias clienteId={f.cliente.id} />
      </div>

      <section className="card">
        <div className="px-4 py-3 border-b border-gray-200 font-semibold flex justify-between">
          <span>Proyectos</span>
          <span className="text-xs text-gray-500 font-normal">
            {enCurso.length} en curso{cerrados ? ` · ${cerrados} cerrados` : ''}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th text-left">Proyecto</th>
                <th className="th text-left w-40">Avance</th>
                <th className="th text-right">Activas</th>
                <th className="th text-right">Atrasadas</th>
                <th className="th text-right">Horas 30 d</th>
                <th className="th text-right">Entrega</th>
              </tr>
            </thead>
            <tbody>
              {f.proyectos.slice(0, 30).map((p) => (
                <tr key={p.id} className={`hover:bg-gray-50 ${['completado', 'cancelado'].includes(p.estado) ? 'text-gray-400' : ''}`}>
                  <td className="td">
                    <Link className="hover:underline" href={`/proyectos/${p.id}`}>
                      {p.nombre}
                    </Link>
                  </td>
                  <td className="td">
                    <AvanceBar valor={p.avance} color={color} alto="h-2" />
                  </td>
                  <td className="td text-right tabular-nums">{p.activos || ''}</td>
                  <td className={`td text-right tabular-nums ${p.atrasados ? 'text-red-600 font-semibold' : ''}`}>{p.atrasados || ''}</td>
                  <td className="td text-right tabular-nums">{p.horas_30d || ''}</td>
                  <td className="td text-right">{fecha(p.fecha_entrega)}</td>
                </tr>
              ))}
              {f.proyectos.length === 0 && (
                <tr>
                  <td className="td text-gray-400" colSpan={6}>
                    Sin proyectos.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <ListaTareas
          titulo="Atrasadas"
          items={f.tareas.atrasadas}
          vacio="Nada atrasado."
          detalle={(t) => `${t.dias_atraso} d · ${fecha(t.fecha_entrega)}`}
        />
        <ListaTareas
          titulo="Esperando al cliente"
          items={f.tareas.esperando_cliente}
          vacio="Nada esperando al cliente."
          detalle={(t) => fecha(t.fecha_entrega)}
        />
        <ListaTareas titulo="Bloqueadas" items={f.tareas.bloqueadas} vacio="Sin bloqueos." detalle={(t) => fecha(t.fecha_entrega)} />
        <ListaTareas
          titulo="Sin movimiento (más de 7 días)"
          items={f.tareas.sin_movimiento}
          vacio="Todo se mueve."
          detalle={(t) => `${t.dias_sin_movimiento} d quieta`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <section className="card">
          <div className="px-4 py-3 border-b border-gray-200 font-semibold">Últimas entregas</div>
          <ul className="divide-y divide-gray-100">
            {f.tareas.ultimas_completadas.length === 0 && <li className="p-4 text-sm text-gray-400">Sin entregas recientes.</li>}
            {f.tareas.ultimas_completadas.map((t) => (
              <li key={t.id} className="px-4 py-2.5 text-sm flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium break-words">{t.titulo_interno}</div>
                  <div className="text-xs text-gray-500">{[t.proyecto, t.responsables.join(', ')].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="text-xs shrink-0 text-right">
                  <div className="tabular-nums">{fecha(t.completado_at ? diaLocal(t.completado_at) : null)}</div>
                  {t.a_tiempo === true && <span className="text-green-700">a tiempo</span>}
                  {t.a_tiempo === false && <span className="text-red-600">tarde</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="card">
          <div className="px-4 py-3 border-b border-gray-200 font-semibold flex justify-between">
            <span>Señales de esta semana</span>
            <span className="text-gray-400 tabular-nums">{f.senales.length}</span>
          </div>
          <ul className="divide-y divide-gray-100">
            {f.senales.length === 0 && <li className="p-4 text-sm text-gray-400">Sin señales esta semana.</li>}
            {f.senales.map((s) => (
              <li key={s.id} className={`px-4 py-2.5 text-sm flex items-start gap-3 ${s.atendida ? 'opacity-60' : ''}`}>
                <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${SEV[s.severidad]}`}>{s.severidad}</span>
                <div className="min-w-0">
                  <div className="break-words">{s.titulo}</div>
                  <div className="text-xs text-gray-500">
                    {s.tipo.replace(/_/g, ' ')}
                    {s.atendida ? ' · atendida' : ''}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {!f.cliente.activo && (
        <p className="text-xs text-gray-500">Este cliente está dado de baja: no aparece en el backlog ni en los rituales.</p>
      )}
    </div>
  );
}
