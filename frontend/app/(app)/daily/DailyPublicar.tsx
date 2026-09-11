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
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error' | 'info'; texto: string; url?: string } | null>(null);
  if (mesas.length === 0) return <span className="text-xs text-gray-400">Configura el board Daily de una mesa en Admin → Mesas para publicar desde aquí.</span>;
  const notasArr = () => notas.split('\n').map((s) => s.trim()).filter(Boolean);

  async function redactar(tipo: 'apertura' | 'cierre') {
    setBusy(`ia-${tipo}`); setMsg(null);
    try {
      const r = await api<{ texto: string; resumen: { hoy: number; vencen: number; bloqueos: number; cambios: number } }>('/ia/daily', { method: 'POST', json: { mesa_id: mesa, tipo, notas: notasArr() } });
      setNarrativa(r.texto);
      setMsg({ tipo: 'info', texto: `Borrador de ${tipo} listo: ${r.resumen.hoy} para hoy, ${r.resumen.vencen} vencen, ${r.resumen.bloqueos} bloqueos, ${r.resumen.cambios} cambios. Edítalo y luego publica.` });
    } catch (e) { setMsg({ tipo: 'error', texto: e instanceof ApiError ? e.message : 'No se pudo redactar' }); }
    setBusy(null);
  }
  async function publicar(tipo: 'apertura' | 'cierre') {
    setBusy(tipo); setMsg(null);
    try {
      const r = await api<{ url: string; resumen: { hoy: number; vencen: number; bloqueos: number; cambios: number } }>('/semanas/daily/publicar', { method: 'POST', json: { mesa_id: mesa, tipo, notas: notasArr(), narrativa: narrativa ?? undefined } });
      setMsg({ tipo: 'ok', texto: `${tipo === 'apertura' ? 'Apertura' : 'Cierre'} publicado en Basecamp: ${r.resumen.hoy} para hoy, ${r.resumen.vencen} vencen, ${r.resumen.bloqueos} bloqueos, ${r.resumen.cambios} cambios.`, url: r.url });
      setNotas(''); setNarrativa(null);
    } catch (e) { setMsg({ tipo: 'error', texto: e instanceof ApiError ? e.message : 'No se pudo publicar' }); }
    setBusy(null);
  }
  return (
    <div className="flex flex-col gap-2 w-full lg:w-auto">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-40" value={mesa} onChange={(e) => setMesa(e.target.value)}>{mesas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select>
        <input className="input w-72" placeholder="Notas clave del día (una por línea)" value={notas} onChange={(e) => setNotas(e.target.value)} />
        {ia && <button className="btn-secondary" disabled={!!busy} onClick={() => redactar('apertura')} title="La IA redacta la apertura con los datos del daily; tú la editas y publicas">{busy === 'ia-apertura' ? 'Redactando…' : '✨ Redactar apertura'}</button>}
        {ia && <button className="btn-secondary" disabled={!!busy} onClick={() => redactar('cierre')}>{busy === 'ia-cierre' ? 'Redactando…' : '✨ Redactar cierre'}</button>}
        <button className="btn-success" disabled={!!busy} onClick={() => publicar('apertura')}>{busy === 'apertura' ? '⏳ Publicando apertura…' : '🟢 Publicar apertura'}</button>
        <button className="btn-danger" disabled={!!busy} onClick={() => publicar('cierre')}>{busy === 'cierre' ? '⏳ Publicando cierre…' : '🔴 Publicar cierre'}</button>
      </div>
      {narrativa !== null && (
        <div className="card p-3 space-y-2">
          <div className="flex justify-between items-center text-xs text-gray-500"><span>Borrador de la IA · edítalo antes de publicar</span><button className="link-danger" onClick={() => setNarrativa(null)}>Descartar</button></div>
          <textarea className="input font-sans text-sm" rows={6} value={narrativa} onChange={(e) => setNarrativa(e.target.value)} />
        </div>
      )}
      {busy && !msg && <div className="rounded-md border border-blue-200 bg-blue-50 text-blue-900 px-3 py-2 text-sm flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />{busy.startsWith('ia') ? 'La IA está redactando con las señales del día…' : 'Armando el mensaje y publicándolo en el board Daily de Basecamp…'}</div>}
      {msg && (
        <div className={`rounded-md border px-3 py-2 text-sm flex items-center justify-between gap-3 ${msg.tipo === 'ok' ? 'border-green-200 bg-green-50 text-green-900' : msg.tipo === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-violet-200 bg-violet-50 text-violet-900'}`}>
          <span>{msg.texto}</span>
          <span className="flex items-center gap-2 shrink-0">{msg.url && <a className="btn-primary text-xs py-1" href={msg.url} target="_blank" rel="noreferrer">Ver en Basecamp ↗</a>}<button className="btn-ghost text-xs py-1" onClick={() => setMsg(null)}>×</button></span>
        </div>
      )}
    </div>
  );
}
