'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';
import { iniciales } from '@/lib/format';

interface Evento { id: string; fecha: string; usuario_id: string; nombre: string; avatar_url: string | null; rol: string; accion: string; texto: string; entidad: string; titulo: string | null; cliente: string | null; ruta: string | null; origen: string }
interface Persona { usuario_id: string; nombre: string; avatar_url: string | null; acciones: number; primera: string; ultima: string }
interface Resp { fecha: string; eventos: Evento[]; por_persona: Persona[] }

const hoyLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-EC', { timeZone: 'America/Guayaquil', hour: '2-digit', minute: '2-digit' });
const mover = (f: string, n: number) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ICONO: Record<string, string> = { crear: '＋', eliminar: '🗑', reprogramar: '↺', actualizar: '✎', reproceso: '⟲', reproceso_cerrado: '✓', crear_proyecto: '▦', publicar_acta: '📣', publicar_daily_apertura: '🟢', publicar_daily_cierre: '🔴', basecamp_importar: '⇄', adoptar_huerfano: '⚠', generar_plan_operativo: '📋', generar_acta_cierre: '✅' };

function Avatar({ nombre, url, size = 36 }: { nombre: string; url: string | null; size?: number }) {
  return url
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={url} alt={nombre} width={size} height={size} className="rounded-full object-cover shrink-0 border border-gray-200" referrerPolicy="no-referrer" style={{ width: size, height: size }} />
    : <div className="rounded-full bg-brand/10 text-brand font-bold flex items-center justify-center shrink-0" style={{ width: size, height: size, fontSize: size / 2.6 }}>{iniciales(nombre)}</div>;
}

export default function DiaADiaPage() {
  const [fecha, setFecha] = useState(hoyLocal());
  const [usuario, setUsuario] = useState('');
  const [d, setD] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cargar = useCallback(async () => { setError(null); try { setD(await api<Resp>(`/actividad?fecha=${fecha}${usuario ? `&usuario=${usuario}` : ''}`)); } catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); } }, [fecha, usuario]);
  useEffect(() => { void cargar(); }, [cargar]);
  const titulo = new Date(`${fecha}T12:00:00Z`).toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  // Agrupar por hora para la línea de tiempo.
  const porHora = new Map<string, Evento[]>();
  for (const e of d?.eventos ?? []) { const h = `${hora(e.fecha).slice(0, 2)}:00`; porHora.set(h, [...(porHora.get(h) ?? []), e]); }

  return (
    <div className="space-y-4 max-w-5xl">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Día a día</h1>
          <p className="text-sm text-gray-500 capitalize">{titulo} <span className="normal-case">· {d?.eventos.length ?? 0} acciones de {d?.por_persona.length ?? 0} personas</span></p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost" onClick={() => setFecha(mover(fecha, -1))}>← Anterior</button>
          <input className="input w-40" type="date" value={fecha} max={hoyLocal()} onChange={(e) => e.target.value && setFecha(e.target.value)} />
          <button className="btn-ghost" disabled={fecha >= hoyLocal()} onClick={() => setFecha(mover(fecha, 1))}>Siguiente →</button>
          <button className="btn-secondary" onClick={() => { setFecha(hoyLocal()); void cargar(); }}>Hoy</button>
        </div>
      </header>
      {error && <Alert tipo="error">{error}</Alert>}
      {d && d.por_persona.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setUsuario('')} className={`rounded-full border px-3 py-1 text-sm ${!usuario ? 'border-brand bg-brand/5 text-brand' : 'border-gray-200 text-gray-600'}`}>Todos</button>
          {d.por_persona.map((p) => (
            <button key={p.usuario_id} onClick={() => setUsuario(usuario === p.usuario_id ? '' : p.usuario_id)} title={`${hora(p.primera)} – ${hora(p.ultima)}`} className={`flex items-center gap-2 rounded-full border pl-1 pr-3 py-1 text-sm ${usuario === p.usuario_id ? 'border-brand bg-brand/5 text-brand' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
              <Avatar nombre={p.nombre} url={p.avatar_url} size={24} />{p.nombre.split(' ')[0]} <b>{p.acciones}</b>
            </button>
          ))}
        </div>
      )}
      <div className="card p-5">
        {d && d.eventos.length === 0 && <p className="text-sm text-gray-400">Sin actividad registrada este día.</p>}
        {!d && !error && <p className="text-sm text-gray-400">Cargando…</p>}
        <ol className="space-y-5">
          {[...porHora.entries()].map(([h, evs]) => (
            <li key={h}>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{h}</div>
              <ul className="space-y-3 border-l-2 border-gray-100 ml-4 pl-5">
                {evs.map((e) => (
                  <li key={e.id} className="relative flex items-start gap-3">
                    <span className="absolute -left-[27px] top-3 h-2.5 w-2.5 rounded-full bg-brand ring-4 ring-white" />
                    <Avatar nombre={e.nombre} url={e.avatar_url} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm"><span className="font-semibold">{e.nombre}</span> <span className="text-gray-700">{e.texto}</span></div>
                      {(e.titulo || e.cliente) && <div className="text-sm text-gray-600 truncate"><span className="mr-1">{ICONO[e.accion] ?? '•'}</span>{e.ruta ? <Link href={e.ruta} className="hover:text-brand underline decoration-gray-300">{e.titulo ?? e.entidad}</Link> : (e.titulo ?? '')}{e.cliente && <span className="text-gray-400"> · {e.cliente}</span>}</div>}
                    </div>
                    <div className="text-xs text-gray-400 whitespace-nowrap pt-1">{hora(e.fecha)}{e.origen !== 'ui' ? ` · ${e.origen}` : ''}</div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </div>
      <p className="text-xs text-gray-500">Muestra lo que cada persona hizo dentro de BackIO. Lo que pasa en Basecamp (completar un to-do, comentar) no aparece aquí con nombre porque llega como evento del sistema. La actividad anterior al 21/09/2026 solo incluye reprogramaciones y reprocesos.</p>
    </div>
  );
}
