import { notFound } from 'next/navigation';
import type { ProyectoDetalle, ClientSafeProject } from '@backio/shared';
import { apiServer } from '@/lib/api.server';
import { ApiError } from '@/lib/api';
import { AvanceBar } from '@/components/ui/AvanceBar';
import { EstadoChip } from '@/components/ui/EstadoChip';
import { fecha } from '@/lib/format';
import { PortalControls } from './PortalControls';
import { VistaCliente } from '@/components/VistaCliente';

export const dynamic = 'force-dynamic';

export default async function ProyectoPage({ params }: { params: { id: string } }) {
  let p: ProyectoDetalle;
  let vista: ClientSafeProject;
  try {
    [p, vista] = await Promise.all([
      apiServer<ProyectoDetalle>(`/proyectos/${params.id}`),
      apiServer<ClientSafeProject>(`/proyectos/${params.id}/vista-cliente`),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const porBloque = new Map<string, typeof p.requerimientos>();
  for (const r of p.requerimientos) {
    const k = r.bloque_nombre ?? 'General';
    porBloque.set(k, [...(porBloque.get(k) ?? []), r]);
  }
  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm text-gray-500">{p.cliente_nombre}</div>
          <h1 className="text-2xl font-bold">{p.nombre}</h1>
          <div className="text-sm text-gray-500 mt-1">Inicio {fecha(p.fecha_inicio)} · Entrega {fecha(p.fecha_entrega)} · <EstadoChip estado={p.estado} />{p.recurrencia_id && <span className="ml-2 text-brand">↻ Fee mensual{p.periodo ? ` ${p.periodo}` : ''}</span>}</div>
        </div>
        <PortalControls proyecto={p} />
      </header>

      <div className="card p-4">
        <div className="label">Avance ponderado interno (todas las tareas)</div>
        <AvanceBar valor={p.avance} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <section className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 font-semibold">Vista interna · {p.requerimientos.length} tareas · {p.requerimientos.filter((r) => r.visible_cliente).length} visibles</div>
          <table className="w-full">
            <thead><tr><th className="th">Tarea</th><th className="th">Entrega</th><th className="th" title="Reprogramaciones / reprocesos">↺</th><th className="th">Peso</th><th className="th">Estado</th><th className="th">Cliente ve</th></tr></thead>
            <tbody>
              {[...porBloque.entries()].map(([bloque, reqs]) => (
                <BloqueRows key={bloque} bloque={bloque} reqs={reqs} />
              ))}
            </tbody>
          </table>
        </section>
        <aside className="space-y-2">
          <div className="font-semibold">Vista cliente (preview real del portal)</div>
          <VistaCliente data={vista} clienteNombre={p.cliente_nombre} />
        </aside>
      </div>
    </div>
  );
}

function BloqueRows({ bloque, reqs }: { bloque: string; reqs: ProyectoDetalle['requerimientos'] }) {
  return (
    <>
      <tr><td className="td bg-gray-50 font-semibold text-xs uppercase tracking-wide text-gray-600" colSpan={6}>{bloque}</td></tr>
      {reqs.map((r) => (
        <tr key={r.id}>
          <td className="td">{r.titulo_interno}{r.basecamp_url && <a className="ml-2 text-xs underline text-gray-500" href={r.basecamp_url} target="_blank" rel="noreferrer">BC</a>}</td>
          <td className="td whitespace-nowrap">{fecha(r.fecha_entrega)}{r.fecha_entrega_original && r.fecha_entrega_original !== r.fecha_entrega && <div className="text-[10px] text-gray-400 line-through">{fecha(r.fecha_entrega_original)}</div>}</td>
          <td className="td text-xs whitespace-nowrap">{r.veces_reprogramado ? <span className="text-amber-700" title="reprogramaciones">↺{r.veces_reprogramado}</span> : null}{r.veces_reproceso ? <span className="ml-1 text-red-700" title="reprocesos">⟲{r.veces_reproceso}</span> : null}</td>
          <td className="td tabular-nums">{Number(r.peso).toFixed(1)}</td>
          <td className="td"><EstadoChip estado={r.estado_operativo} /></td>
          <td className="td text-xs">{r.visible_cliente ? `👁 ${r.etiqueta_cliente}` : <span className="text-gray-400">oculto</span>}</td>
        </tr>
      ))}
    </>
  );
}
