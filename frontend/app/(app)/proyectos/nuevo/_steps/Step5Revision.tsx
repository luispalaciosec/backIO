import { useEffect, useState } from 'react';
import type { Usuario, Cliente, ClientSafeProject } from '@backio/shared';
import { api } from '@/lib/api';
import { VistaCliente } from '@/components/VistaCliente';
import { fecha } from '@/lib/format';
import { toInput, type WizardState } from '../wizard';

interface Preview {
  plan: { tareas: { titulo_interno: string; bloque_nombre: string; fecha_entrega: string; visible_cliente: boolean; etiqueta_cliente: string | null; peso: number; owner_agencia: string[] }[]; visibles: number };
  vista_cliente: ClientSafeProject; // calculada por el backend con la MISMA sanitizeForClient del portal
}

/** Paso 5 · NO OPCIONAL. La ejecutiva ve exactamente la pantalla del cliente antes de que exista. */
export function Step5Revision({ state: s, usuarios, clientes }: { state: WizardState; usuarios: Usuario[]; clientes: Cliente[] }) {
  const [p, setP] = useState<Preview | null>(null);
  useEffect(() => { api<Preview>('/proyectos/preview', { method: 'POST', json: toInput(s) }).then(setP).catch(() => setP(null)); }, [s]);
  const cliente = clientes.find((c) => c.id === s.cliente_id);
  if (!p) return <div className="text-gray-500">Generando preview…</div>;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 font-semibold">Vista interna · {p.plan.tareas.length} tareas · {p.plan.visibles} visibles</div>
        <table className="w-full"><thead><tr><th className="th">Tarea</th><th className="th">Owner</th><th className="th">Entrega</th><th className="th text-right">Peso</th></tr></thead>
          <tbody>{p.plan.tareas.map((t, i) => (
            <tr key={i}>
              <td className="td"><span className="text-xs text-gray-400">{t.bloque_nombre} · </span>{t.titulo_interno}{t.visible_cliente && <span className="ml-2 text-xs text-brand">👁 {t.etiqueta_cliente}</span>}</td>
              <td className="td">{usuarios.find((u) => u.id === t.owner_agencia[0])?.nombre ?? '—'}</td>
              <td className="td whitespace-nowrap">{fecha(t.fecha_entrega)}</td>
              <td className="td text-right tabular-nums">{t.peso.toFixed(1)}</td>
            </tr>
          ))}</tbody></table>
      </section>
      <section className="space-y-2">
        <div className="font-semibold">Vista cliente · preview exacto del portal</div>
        <VistaCliente data={p.vista_cliente} clienteNombre={cliente?.nombre ?? ''} logoUrl={cliente?.logo_url} color={cliente?.color_primario ?? '#0073EA'} />
        <p className="text-xs text-gray-500">Si algo no debe estar aquí, se corrige en la plantilla antes de crear, no después.</p>
      </section>
    </div>
  );
}
