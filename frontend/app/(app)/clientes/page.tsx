import Link from 'next/link';
import type { Cliente, Mesa, Usuario } from '@backio/shared';
import { nombrePersona } from '@backio/shared';
import { apiServer } from '@/lib/api.server';
import { meServer, puedeEscribir } from '@/lib/me.server';
import { USUARIOS_CON_INACTIVOS } from '@/lib/personas';
import { Semaforo } from '@/components/dashboard/Charts';
import { Avatar } from '@/components/kpis/comun';

export const dynamic = 'force-dynamic';

interface FilaSalud {
  cliente_id: string;
  salud: 'verde' | 'amarillo' | 'rojo';
  salud_motivos?: string[];
  activos: number;
  atrasados: number;
  esperando_cliente: number;
  pct_a_tiempo_original_30d: number | null;
}

const ORDEN_SALUD = { rojo: 0, amarillo: 1, verde: 2 } as const;

/**
 * Clientes (docs/21): salud, ejecutiva y mesa de cada cuenta. Para una ejecutiva abre en «Mis cuentas». La salud es la
 * misma del dashboard (saludCliente); un cliente sin trabajo reciente no tiene fila de salud y sale en gris.
 */
export default async function ClientesPage({ searchParams: spP }: { searchParams: Promise<{ mesa?: string; ejecutiva?: string }> }) {
  const sp = await spP;
  const me = await meServer();
  if (!puedeEscribir(me.rol)) return <p className="text-sm text-gray-500">La vista de clientes es para el equipo de gestión.</p>;
  const [{ items: clientes }, { items: usuarios }, { items: mesas }, dash] = await Promise.all([
    apiServer<{ items: Cliente[] }>('/clientes'),
    apiServer<{ items: Usuario[] }>(USUARIOS_CON_INACTIVOS),
    apiServer<{ items: Mesa[] }>('/mesas'),
    apiServer<{ por_cliente: FilaSalud[] }>('/dashboard'),
  ]);
  const conTrabajo = new Set(dash.por_cliente.map((f) => f.cliente_id));
  // Solo cuentas reales: con mesa, con ejecutiva o con trabajo en BackIO. Las demás son empresas de PrometIO que todavía
  // son contactos del CRM (sin mesa, proyectos ni tareas) y no se muestran (pedido de Luis, 29/10/2026).
  const reales = clientes.filter((c) => !c.es_prueba && (c.mesa_id || c.ejecutiva_id || conTrabajo.has(c.id)));
  const esEjecutiva = !!me.usuario_id && reales.some((c) => c.ejecutiva_id === me.usuario_id);
  // Una ejecutiva abre en sus cuentas; «todas» las muestra todas.
  const ejecutiva = sp.ejecutiva === 'todas' ? '' : (sp.ejecutiva ?? (esEjecutiva ? me.usuario_id! : ''));
  const mesa = sp.mesa ?? '';
  const salud = new Map(dash.por_cliente.map((f) => [f.cliente_id, f]));
  const persona = (id: string | null | undefined) => usuarios.find((u) => u.id === id);
  const ejecutivas = [...new Set(reales.map((c) => c.ejecutiva_id).filter((x): x is string => !!x))]
    .map((id) => persona(id))
    .filter((u): u is Usuario => !!u);
  const lista = reales
    .filter((c) => (!mesa || c.mesa_id === mesa) && (!ejecutiva || c.ejecutiva_id === ejecutiva))
    .sort((a, b) => {
      const sa = salud.get(a.id),
        sb = salud.get(b.id);
      return (
        (sa ? ORDEN_SALUD[sa.salud] : 3) - (sb ? ORDEN_SALUD[sb.salud] : 3) ||
        (sb?.atrasados ?? 0) - (sa?.atrasados ?? 0) ||
        a.nombre.localeCompare(b.nombre, 'es')
      );
    });
  const href = (cambios: { mesa?: string; ejecutiva?: string }) => {
    const q = new URLSearchParams();
    const m = cambios.mesa ?? mesa;
    const e = cambios.ejecutiva ?? (ejecutiva || (esEjecutiva ? 'todas' : ''));
    if (m) q.set('mesa', m);
    if (e) q.set('ejecutiva', e);
    return `/clientes${q.size ? `?${q}` : ''}`;
  };
  const chip = (activo: boolean) =>
    `rounded-full px-3 py-1 border text-sm ${activo ? 'bg-brand text-white border-brand' : 'border-gray-300 hover:bg-gray-50'}`;

  return (
    <div className="space-y-4">
      <header className="space-y-3">
        <div>
          <h1 className="text-2xl font-bold">Clientes</h1>
          <p className="text-sm text-gray-500">Salud de cada cuenta, quién la lleva y en qué mesa se produce.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {esEjecutiva && (
            <Link href={href({ ejecutiva: me.usuario_id! })} className={chip(ejecutiva === me.usuario_id)}>
              Mis cuentas
            </Link>
          )}
          <Link href={href({ ejecutiva: 'todas' })} className={chip(!ejecutiva)}>
            Todas
          </Link>
          {ejecutivas
            .filter((u) => u.id !== me.usuario_id)
            .map((u) => (
              <Link key={u.id} href={href({ ejecutiva: u.id })} className={chip(ejecutiva === u.id)}>
                {nombrePersona(u)}
              </Link>
            ))}
          <span className="mx-2 h-5 border-l border-gray-200" />
          <Link href={href({ mesa: '' })} className={chip(!mesa)}>
            Todas las mesas
          </Link>
          {mesas
            .filter((m) => m.activa)
            .map((m) => (
              <Link key={m.id} href={href({ mesa: m.id })} className={chip(mesa === m.id)}>
                {m.nombre}
              </Link>
            ))}
        </div>
      </header>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th w-6" />
              <th className="th text-left">Cliente</th>
              <th className="th text-left">Ejecutiva</th>
              <th className="th text-left">Mesa</th>
              <th className="th text-right">Activas</th>
              <th className="th text-right">Atrasadas</th>
              <th className="th text-right">Esperando cliente</th>
              <th className="th text-right" title="Entregas de los últimos 30 días a tiempo según la fecha original">
                A tiempo 30 d
              </th>
            </tr>
          </thead>
          <tbody>
            {lista.map((c) => {
              const s = salud.get(c.id);
              const e = persona(c.ejecutiva_id);
              return (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="td">
                    {s ? (
                      <Semaforo salud={s.salud} motivos={s.salud_motivos} />
                    ) : (
                      <span className="inline-block w-3 h-3 rounded-full bg-gray-200" title="Sin trabajo reciente" />
                    )}
                  </td>
                  <td className="td">
                    <Link className="font-medium hover:underline" href={`/clientes/${c.id}`}>
                      {c.nombre}
                    </Link>
                    {s?.salud_motivos?.length ? <div className="text-[11px] text-gray-500">{s.salud_motivos.join(' · ')}</div> : null}
                  </td>
                  <td className="td">
                    {e ? (
                      <span className="inline-flex items-center gap-2">
                        <Avatar nombre={nombrePersona(e)} url={e.avatar_url} size={22} />
                        {nombrePersona(e)}
                      </span>
                    ) : (
                      <span className="text-gray-400">Sin asignar</span>
                    )}
                  </td>
                  <td className="td text-gray-600">{mesas.find((m) => m.id === c.mesa_id)?.nombre ?? '—'}</td>
                  <td className="td text-right tabular-nums">{s?.activos ?? 0}</td>
                  <td className={`td text-right tabular-nums ${s?.atrasados ? 'text-red-600 font-semibold' : ''}`}>{s?.atrasados || ''}</td>
                  <td className="td text-right tabular-nums">{s?.esperando_cliente || ''}</td>
                  <td className="td text-right tabular-nums">
                    {s?.pct_a_tiempo_original_30d === null || s?.pct_a_tiempo_original_30d === undefined
                      ? '—'
                      : `${s.pct_a_tiempo_original_30d} %`}
                  </td>
                </tr>
              );
            })}
            {lista.length === 0 && (
              <tr>
                <td className="td text-gray-400" colSpan={8}>
                  No hay clientes con estos filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
