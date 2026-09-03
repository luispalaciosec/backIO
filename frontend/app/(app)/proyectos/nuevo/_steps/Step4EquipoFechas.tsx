import { useEffect, useState } from 'react';
import type { Usuario } from '@backio/shared';
import { api } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';
import { fecha } from '@/lib/format';
import { toInput, type WizardState } from '../wizard';

interface Preview {
  plan: { tareas: { titulo_interno: string; bloque_nombre: string; fecha_entrega: string; owner_agencia: string[] }[] };
  alertas: { nombre: string; tareas: number; total: number; pct: number; semana_inicio: string }[];
}

export function Step4EquipoFechas({ state: s, set, usuarios }: { state: WizardState; set: (p: Partial<WizardState>) => void; usuarios: Usuario[] }) {
  const plantilla = s.plantilla!;
  const [preview, setPreview] = useState<Preview | null>(null);
  const upd = (id: string, owner_id: string | null) => set({ bloques: { ...s.bloques, [id]: { ...s.bloques[id]!, owner_id } } });

  useEffect(() => {
    const t = setTimeout(() => {
      api<Preview>('/proyectos/preview', { method: 'POST', json: toInput(s) }).then(setPreview).catch(() => setPreview(null));
    }, 300);
    return () => clearTimeout(t);
  }, [s]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-3">
        <p className="text-sm text-gray-500">Owner por bloque (no por tarea). Las fechas se calculan hacia atrás desde el {fecha(s.fecha_entrega)}.</p>
        {plantilla.bloques.filter((b) => s.bloques[b.id]?.activo ?? true).map((b) => (
          <div key={b.id} className="card p-4 flex items-center justify-between gap-3">
            <span className="font-medium">{b.nombre}</span>
            <select className="input max-w-56" value={s.bloques[b.id]?.owner_id ?? ''} onChange={(e) => upd(b.id, e.target.value || null)}>
              <option value="">Sin asignar</option>
              {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select>
          </div>
        ))}
        {preview?.alertas.map((a, i) => (
          <Alert key={i} tipo="warn">⚠️ {a.nombre} queda con {a.tareas} de {a.total} tareas en la semana del {fecha(a.semana_inicio)} ({a.pct}%). Considera redistribuir o mover fechas.</Alert>
        ))}
      </div>
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 font-semibold">Cronograma calculado</div>
        <table className="w-full"><thead><tr><th className="th">Tarea</th><th className="th">Owner</th><th className="th">Entrega</th></tr></thead>
          <tbody>
            {!preview && <tr><td className="td text-gray-400" colSpan={3}>Calculando…</td></tr>}
            {preview?.plan.tareas.map((t, i) => (
              <tr key={i}><td className="td"><span className="text-xs text-gray-400">{t.bloque_nombre} · </span>{t.titulo_interno}</td><td className="td">{usuarios.find((u) => u.id === t.owner_agencia[0])?.nombre ?? '—'}</td><td className="td whitespace-nowrap">{fecha(t.fecha_entrega)}</td></tr>
            ))}
          </tbody></table>
      </div>
    </div>
  );
}
