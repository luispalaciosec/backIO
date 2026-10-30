import Link from 'next/link';
import type { RentabilidadMes } from '@backio/shared';
import { hoyLocal } from '@backio/shared';
import { apiServer } from '@/lib/api.server';
import { meServer } from '@/lib/me.server';
import { dinero } from '@/lib/format';

export const dynamic = 'force-dynamic';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]} ${mes.slice(0, 4)}`;
const sumarMeses = (mes: string, n: number) => {
  const [a, m] = mes.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 7);
};

/** Rentabilidad por cliente (docs/21): solo gerencia y admin. */
export default async function RentabilidadPage({ searchParams: spP }: { searchParams: Promise<{ mes?: string }> }) {
  const sp = await spP;
  const me = await meServer();
  if (me.rol !== 'admin' && me.rol !== 'gerencia')
    return <p className="text-sm text-gray-500">La rentabilidad es solo para gerencia y admin.</p>;
  const actual = hoyLocal().slice(0, 7);
  const mes = sp.mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes) && sp.mes <= actual ? sp.mes : actual;
  const r = await apiServer<RentabilidadMes>(`/rentabilidad?mes=${mes}`);
  const sinFee = r.clientes.filter((c) => c.fee === null);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Rentabilidad · {nombreMes(mes)}</h1>
          <p className="text-sm text-gray-500">
            Fee del cliente menos el sueldo de cada persona repartido según las horas que registró en ese cliente durante el mes.
          </p>
        </div>
        <nav className="flex items-center gap-2 text-sm">
          <Link className="btn-secondary text-xs" href={`/rentabilidad?mes=${sumarMeses(mes, -1)}`}>
            ← {nombreMes(sumarMeses(mes, -1))}
          </Link>
          {mes < actual && (
            <Link className="btn-secondary text-xs" href={`/rentabilidad?mes=${sumarMeses(mes, 1)}`}>
              {nombreMes(sumarMeses(mes, 1))} →
            </Link>
          )}
          <Link className="btn-primary text-xs" href="/rentabilidad/costos">
            Sueldos y fees
          </Link>
        </nav>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          ['Fees del mes', r.totales.fee],
          ['Costo repartido', r.totales.costo],
          ['Margen', r.totales.margen],
        ].map(([k, v]) => (
          <div key={k as string} className="card p-4">
            <div className="text-xs uppercase tracking-wide text-gray-500">{k}</div>
            <div className={`text-3xl font-bold tabular-nums mt-1 ${k === 'Margen' && (v as number) < 0 ? 'text-red-600' : ''}`}>
              {dinero(v as number)}
            </div>
          </div>
        ))}
      </section>

      {(r.sin_repartir.total > 0 || r.sin_sueldo.length > 0 || r.horas_sin_costo > 0 || sinFee.length > 0) && (
        <section className="card p-4 text-sm space-y-1.5 bg-amber-50/60">
          <div className="font-semibold">Lo que este cálculo no cubre</div>
          {r.sin_repartir.total > 0 && (
            <p>
              <b>{dinero(r.sin_repartir.total)}</b> de sueldos sin horas registradas en el mes, que no se pueden repartir entre clientes:{' '}
              {r.sin_repartir.personas.map((p) => p.nombre).join(', ')}.
            </p>
          )}
          {r.sin_sueldo.length > 0 && (
            <p>
              Personas con horas pero sin sueldo cargado (sus horas no tienen costo):{' '}
              {r.sin_sueldo.map((p) => `${p.nombre} (${Math.round(p.horas)} h)`).join(', ')}.
            </p>
          )}
          {r.horas_sin_costo > 0 && <p>{Math.round(r.horas_sin_costo)} h del timesheet sin persona o sin cliente.</p>}
          {sinFee.length > 0 && <p>{sinFee.length} clientes con costo pero sin fee cargado: su margen no se puede calcular.</p>}
        </section>
      )}

      <section className="card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Cliente</th>
              <th className="th text-right">Fee</th>
              <th className="th text-right">Costo</th>
              <th className="th text-right">Margen</th>
              <th className="th text-right">%</th>
              <th className="th text-right">Horas</th>
              <th className="th">Quién</th>
            </tr>
          </thead>
          <tbody>
            {r.clientes.map((c) => (
              <tr key={c.cliente_id}>
                <td className="td">
                  <Link href={`/clientes/${c.cliente_id}`} className="hover:underline">
                    {c.cliente}
                  </Link>
                </td>
                <td className="td text-right tabular-nums">{dinero(c.fee)}</td>
                <td className="td text-right tabular-nums">{dinero(c.costo)}</td>
                <td className={`td text-right tabular-nums font-semibold ${c.margen !== null && c.margen < 0 ? 'text-red-600' : ''}`}>
                  {dinero(c.margen)}
                </td>
                <td className={`td text-right tabular-nums ${c.margen_pct !== null && c.margen_pct < 20 ? 'text-amber-700' : ''}`}>
                  {c.margen_pct === null ? '—' : `${c.margen_pct} %`}
                </td>
                <td className="td text-right tabular-nums">{Math.round(c.horas)}</td>
                <td className="td text-xs text-gray-500">
                  {c.personas
                    .slice(0, 3)
                    .map((p) => `${p.nombre.split(' ')[0]} ${Math.round(p.horas)} h`)
                    .join(' · ')}
                  {c.personas.length > 3 ? ` y ${c.personas.length - 3} más` : ''}
                </td>
              </tr>
            ))}
            {r.clientes.length === 0 && (
              <tr>
                <td className="td text-gray-400" colSpan={7}>
                  Sin fees ni sueldos cargados para este mes. Cárgalos en «Sueldos y fees».
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
