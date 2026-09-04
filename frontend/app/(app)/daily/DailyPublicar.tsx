'use client';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';

export function DailyPublicar({ mesas }: { mesas: { id: string; nombre: string }[] }) {
  const [mesa, setMesa] = useState(mesas[0]?.id ?? '');
  const [notas, setNotas] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (mesas.length === 0) return <span className="text-xs text-gray-400">Configura el board Daily de una mesa en Admin → Mesas para publicar desde aquí.</span>;

  async function publicar(tipo: 'apertura' | 'cierre') {
    setBusy(tipo); setMsg(null);
    try {
      const r = await api<{ url: string; resumen: { vencen: number; bloqueos: number; cambios: number } }>('/semanas/daily/publicar', { method: 'POST', json: { mesa_id: mesa, tipo, notas: notas.split('\n').map((s) => s.trim()).filter(Boolean) } });
      setMsg(`Publicado en Basecamp: ${r.resumen.vencen} vencen, ${r.resumen.bloqueos} bloqueos, ${r.resumen.cambios} cambios.`);
      window.open(r.url, '_blank');
      setNotas('');
    } catch (e) { setMsg(e instanceof ApiError ? e.message : 'Error'); }
    setBusy(null);
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className="input w-40" value={mesa} onChange={(e) => setMesa(e.target.value)}>{mesas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select>
      <input className="input w-72" placeholder="Notas clave del día (una por línea)" value={notas} onChange={(e) => setNotas(e.target.value)} />
      <button className="btn-secondary" disabled={!!busy} onClick={() => publicar('apertura')}>🟢 Publicar apertura</button>
      <button className="btn-secondary" disabled={!!busy} onClick={() => publicar('cierre')}>🔴 Publicar cierre</button>
      {msg && <span className="text-xs text-gray-600 w-full">{msg}</span>}
    </div>
  );
}
