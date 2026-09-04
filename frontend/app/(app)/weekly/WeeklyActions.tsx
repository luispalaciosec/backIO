'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { Acta } from '@backio/shared';
import { api } from '@/lib/api';

export function WeeklyActions({ semanaId, mesas }: { semanaId: string; mesas: { id: string; nombre: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [acta, setActa] = useState<Acta | null>(null);
  const [mesa, setMesa] = useState<string>(mesas[0]?.id ?? '');
  const [pub, setPub] = useState<{ url: string } | null>(null);
  const q = mesa ? `?mesa=${mesa}` : '';

  async function run(nombre: string, fn: () => Promise<void>) {
    setBusy(nombre);
    try { await fn(); router.refresh(); } catch (e) { alert(e instanceof Error ? e.message : 'Error'); }
    setBusy(null);
  }
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <select className="input w-44" value={mesa} onChange={(e) => setMesa(e.target.value)} title="Mesa para los documentos">
        <option value="">Toda la agencia</option>
        {mesas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
      </select>
      <button className="btn-secondary" disabled={!!busy} onClick={() => run('senales', async () => { await api(`/semanas/${semanaId}/senales/recalcular`, { method: 'POST' }); })}>↻ Recalcular señales</button>
      <button className="btn-primary" disabled={!!busy} onClick={() => run('plan', async () => { setPub(null); setActa(await api<Acta>(`/semanas/${semanaId}/plan${q}`, { method: 'POST' })); })}>📋 Generar Plan Operativo</button>
      <button className="btn-success" disabled={!!busy} onClick={() => run('acta', async () => { setPub(null); setActa(await api<Acta>(`/semanas/${semanaId}/acta${q}`, { method: 'POST' })); })}>✅ Generar Acta de Cierre</button>
      {acta && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50" onClick={() => setActa(null)}>
          <div className="card max-w-3xl w-full max-h-[85vh] overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3 gap-2">
              <div className="font-semibold">{acta.tipo === 'plan_operativo' ? 'Plan Operativo' : 'Acta de Cierre'} · listo para Basecamp</div>
              <div className="flex gap-2">
                <button className="btn-ghost" onClick={() => navigator.clipboard.writeText(acta.markdown)}>Copiar</button>
                {acta.mesa_id && !pub && <button className="btn-primary" disabled={!!busy} onClick={() => run('pub', async () => setPub(await api<{ url: string }>(`/semanas/actas/${acta.id}/publicar`, { method: 'POST' })))}>Publicar en Basecamp</button>}
                {pub && <a className="btn-secondary" href={pub.url} target="_blank" rel="noreferrer">Ver en Basecamp ↗</a>}
              </div>
            </div>
            {!acta.mesa_id && <p className="text-xs text-amber-700 mb-2">Documento de toda la agencia: para publicarlo en Basecamp genera el de una mesa.</p>}
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
