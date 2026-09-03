'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { Acta } from '@backio/shared';
import { api } from '@/lib/api';

export function WeeklyActions({ semanaId }: { semanaId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [acta, setActa] = useState<Acta | null>(null);

  async function run(nombre: string, fn: () => Promise<void>) {
    setBusy(nombre);
    try { await fn(); router.refresh(); } catch (e) { alert(e instanceof Error ? e.message : 'Error'); }
    setBusy(null);
  }
  return (
    <div className="flex flex-wrap gap-2">
      <button className="btn-secondary" disabled={!!busy} onClick={() => run('senales', async () => { await api(`/semanas/${semanaId}/senales/recalcular`, { method: 'POST' }); })}>Recalcular señales</button>
      <button className="btn-secondary" disabled={!!busy} onClick={() => run('plan', async () => setActa(await api<Acta>(`/semanas/${semanaId}/plan`, { method: 'POST' })))}>Generar Plan Operativo</button>
      <button className="btn-secondary" disabled={!!busy} onClick={() => run('acta', async () => setActa(await api<Acta>(`/semanas/${semanaId}/acta`, { method: 'POST' })))}>Generar Acta de Cierre</button>
      {acta && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50" onClick={() => setActa(null)}>
          <div className="card max-w-3xl w-full max-h-[85vh] overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3"><div className="font-semibold">{acta.tipo === 'plan_operativo' ? 'Plan Operativo' : 'Acta de Cierre'} · markdown listo para Basecamp</div><button className="btn-ghost" onClick={() => navigator.clipboard.writeText(acta.markdown)}>Copiar</button></div>
            <pre className="whitespace-pre-wrap text-xs font-mono bg-gray-50 p-4 rounded">{acta.markdown}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

export function AcuerdoForm({ semanaId, usuarios }: { semanaId: string; usuarios: { id: string; nombre: string }[] }) {
  const router = useRouter();
  const [f, setF] = useState({ descripcion: '', responsable_id: '', fecha_compromiso: '' });
  const [err, setErr] = useState<string | null>(null);
  const manana = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api(`/semanas/${semanaId}/acuerdos`, { method: 'POST', json: f });
      setF({ descripcion: '', responsable_id: '', fecha_compromiso: '' });
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
  }
  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <input className="input" placeholder="Acuerdo" required value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} />
      <select className="input" required value={f.responsable_id} onChange={(e) => setF({ ...f, responsable_id: e.target.value })}>
        <option value="">Responsable…</option>
        {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
      </select>
      <input className="input" type="date" required min={manana} value={f.fecha_compromiso} onChange={(e) => setF({ ...f, fecha_compromiso: e.target.value })} />
      {err && <p className="text-xs text-red-600">{err}</p>}
      <button className="btn-primary w-full">Guardar acuerdo</button>
    </form>
  );
}
