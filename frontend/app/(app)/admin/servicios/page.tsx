'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';
import { ZONA } from '@backio/shared';

type Estado = 'ok' | 'degradado' | 'caido' | 'no_configurado';
interface Servicio {
  id: string;
  nombre: string;
  estado: Estado;
  latencia_ms: number | null;
  detalle: string | null;
}
interface Job {
  nombre: string;
  descripcion: string;
  ultima_at: string | null;
  estado: 'al_dia' | 'con_errores' | 'sin_correr' | 'sin_registro';
}
interface Salud {
  verificado_at: string;
  todo_ok: boolean;
  servicios: Servicio[];
  jobs?: Job[];
}
const ESTADO_JOB: Record<Job['estado'], { label: string; punto: string }> = {
  al_dia: { label: 'Al día', punto: 'bg-green-500' },
  con_errores: { label: 'Última corrida con errores', punto: 'bg-amber-500' },
  sin_correr: { label: 'Atrasado', punto: 'bg-red-500' },
  sin_registro: { label: 'Aún no corre', punto: 'bg-gray-400' },
};

const ICONO: Record<string, string> = {
  railway: '🚂',
  vercel: '▲',
  supabase_db: '🗄️',
  supabase_auth: '🔐',
  basecamp: '🏕️',
  resend: '✉️',
  anthropic: '✨',
  prometio: '💼',
};
const ESTADO: Record<Estado, { label: string; punto: string }> = {
  ok: { label: 'Operativo', punto: 'bg-green-500' },
  degradado: { label: 'Lento', punto: 'bg-amber-500' },
  caido: { label: 'Caído', punto: 'bg-red-500' },
  no_configurado: { label: 'No configurado', punto: 'bg-gray-400' },
};

export default function ServiciosPage() {
  const [d, setD] = useState<Salud | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cargar = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setD(await api<Salud>('/admin/salud'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error');
    }
    setBusy(false);
  }, []);
  useEffect(() => {
    void cargar();
  }, [cargar]);
  const caidos = d?.servicios.filter((s) => s.estado === 'caido') ?? [];
  const lentos = d?.servicios.filter((s) => s.estado === 'degradado') ?? [];
  return (
    <div className="space-y-4 max-w-5xl">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Salud del sistema</h1>
          <p className="text-sm text-gray-500">
            Estado y latencia de los servicios de los que depende BackIO. Sin detalle interno de errores.
          </p>
          {d && <p className="text-xs text-gray-400 mt-1">Verificado {new Date(d.verificado_at).toLocaleString('es-EC')}</p>}
        </div>
        <button className="btn-secondary" disabled={busy} onClick={cargar}>
          {busy ? 'Verificando…' : 'Actualizar'}
        </button>
      </header>
      {error && <Alert tipo="error">{error}</Alert>}
      {d && (
        <div
          className={`rounded-md border px-4 py-3 ${caidos.length ? 'border-red-200 bg-red-50 text-red-900' : lentos.length ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-teal-200 bg-teal-50 text-teal-900'}`}
        >
          <div className="font-semibold">
            {caidos.length
              ? `${caidos.length} ${caidos.length === 1 ? 'servicio caído' : 'servicios caídos'}: ${caidos.map((s) => s.nombre).join(', ')}`
              : lentos.length
                ? `Todo responde, ${lentos.length} con latencia alta`
                : 'Todos los sistemas operativos'}
          </div>
          <div className="text-sm opacity-80">
            {caidos.length
              ? 'Revisa el servicio afectado; el resto sigue funcionando.'
              : 'Los servicios chequeados responden. El detalle de cada uno está abajo.'}
          </div>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {(d?.servicios ?? []).map((s) => (
          <div key={s.id} className="card p-4 flex items-center gap-4">
            <div className="h-11 w-11 rounded-lg bg-gray-100 flex items-center justify-center text-xl">{ICONO[s.id] ?? '•'}</div>
            <div className="min-w-0">
              <div className="font-semibold">{s.nombre}</div>
              <div className="text-sm text-gray-600 flex items-center gap-2">
                <span className={`inline-block h-2 w-2 rounded-full ${ESTADO[s.estado].punto}`} />
                {ESTADO[s.estado].label}
                {s.latencia_ms !== null ? ` · ${s.latencia_ms} ms` : ''}
              </div>
              {s.detalle && <div className="text-xs text-gray-400 truncate">{s.detalle}</div>}
            </div>
          </div>
        ))}
        {!d && !error && <p className="text-sm text-gray-400">Verificando servicios…</p>}
      </div>
      {d?.jobs && d.jobs.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Tareas programadas</h2>
          <p className="text-sm text-gray-500">
            Lo que BackIO corre solo. Si una no corre a su hora, llega un correo a las personas admin.
          </p>
          <div className="card divide-y">
            {d.jobs.map((j) => (
              <div key={j.nombre} className="px-4 py-2 flex items-center justify-between gap-4 text-sm">
                <span className="min-w-0">{j.descripcion}</span>
                <span className="shrink-0 text-gray-600 flex items-center gap-2">
                  <span className={`inline-block h-2 w-2 rounded-full ${ESTADO_JOB[j.estado].punto}`} />
                  {ESTADO_JOB[j.estado].label}
                  {j.ultima_at && (
                    <span className="text-xs text-gray-400">
                      ·{' '}
                      {new Date(j.ultima_at).toLocaleString('es-EC', {
                        timeZone: ZONA,
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
