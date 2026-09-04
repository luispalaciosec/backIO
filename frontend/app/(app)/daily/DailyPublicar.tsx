'use client';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useIA } from '@/lib/useIA';

export function DailyPublicar({ mesas }: { mesas: { id: string; nombre: string }[] }) {
  const ia = useIA();
  const [mesa, setMesa] = useState(mesas[0]?.id ?? '');
  const [notas, setNotas] = useState('');
  const [narrativa, setNarrativa] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (mesas.length === 0) return <span className="text-xs text-gray-400">Configura el board Daily de una mesa en Admin → Mesas para publicar desde aquí.</span>;
  const notasArr = () => notas.split('\n').map((s) => s.trim()).filter(Boolean);

  async function redactar(tipo: 'apertura' | 'cierre') {
    setBusy(`ia-${tipo}`); setMsg(null);
    try {
      const r = await api<{ texto: string; resumen: { vencen: number; bloqueos: number; cambios: number } }>('/ia/daily', { method: 'POST', json: { mesa_id: mesa, tipo, notas: notasArr() } });
      setNarrativa(r.texto);
      setMsg(`Borrador de ${tipo} listo. Edítalo y publícalo; irá firmado "Redactado por BackIO, publicado por ti".`);
    } catch (e) { setMsg(e instanceof ApiError ? e.message : 'Error'); }
    setBusy(null);
  }
  async function publicar(tipo: 'apertura' | 'cierre') {
    setBusy(tipo); setMsg(null);
    try {
      const r = await api<{ url: string; resumen: { vencen: number; bloqueos: number; cambios: number } }>('/semanas/daily/publicar', { method: 'POST', json: { mesa_id: mesa, tipo, notas: notasArr(), narrativa: narrativa ?? undefined } });
      setMsg(`Publicado en Basecamp: ${r.resumen.vencen} vencen, ${r.resumen.bloqueos} bloqueos, ${r.resumen.cambios} cambios.`);
      window.open(r.url, '_blank');
      setNotas(''); setNarrativa(null);
    } catch (e) { setMsg(e instanceof ApiError ? e.message : 'Error'); }
    setBusy(null);
  }
  return (
    <div className="flex flex-col gap-2 w-full lg:w-auto">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-40" value={mesa} onChange={(e) => setMesa(e.target.value)}>{mesas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select>
        <input className="input w-72" placeholder="Notas clave del día (una por línea)" value={notas} onChange={(e) => setNotas(e.target.value)} />
        {ia && <button className="btn-secondary" disabled={!!busy} onClick={() => redactar('apertura')} title="La IA redacta la apertura con los datos del daily; tú la editas y publicas">{busy === 'ia-apertura' ? 'Redactando…' : '✨ Redactar apertura'}</button>}
        {ia && <button className="btn-secondary" disabled={!!busy} onClick={() => redactar('cierre')}>{busy === 'ia-cierre' ? 'Redactando…' : '✨ Redactar cierre'}</button>}
        <button className="btn-success" disabled={!!busy} onClick={() => publicar('apertura')}>Publicar apertura</button>
        <button className="btn-danger" disabled={!!busy} onClick={() => publicar('cierre')}>Publicar cierre</button>
      </div>
      {narrativa !== null && (
        <div className="card p-3 space-y-2">
          <div className="flex justify-between items-center text-xs text-gray-500"><span>Borrador de la IA · edítalo antes de publicar</span><button className="link-danger" onClick={() => setNarrativa(null)}>Descartar</button></div>
          <textarea className="input font-sans text-sm" rows={6} value={narrativa} onChange={(e) => setNarrativa(e.target.value)} />
        </div>
      )}
      {msg && <span className="text-xs text-gray-600">{msg}</span>}
    </div>
  );
}
