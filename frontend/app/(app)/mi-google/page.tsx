'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';

interface MiGoogle {
  configurado: boolean;
  conectado: boolean;
  email: string | null;
  conectado_at: string | null;
}

function Contenido() {
  const params = useSearchParams();
  const [estado, setEstado] = useState<MiGoogle | null>(null);
  const [error, setError] = useState<string | null>(params.get('google') === 'error' ? params.get('motivo') : null);
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setEstado(await api<MiGoogle>('/google/mi-cuenta'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo leer tu conexión');
    }
  }, []);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function conectar() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api<{ url: string }>('/google/mi-cuenta/url');
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo iniciar la conexión');
      setBusy(false);
    }
  }
  async function desconectar() {
    if (!confirm('¿Desconectar tu Google Calendar? Tus reuniones dejarán de contarse desde la próxima sincronización.')) return;
    setBusy(true);
    try {
      await api('/google/mi-cuenta', { method: 'DELETE' });
      await cargar();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo desconectar');
    }
    setBusy(false);
  }

  return (
    <div className="max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Mi Google Calendar</h1>
        <p className="text-sm text-gray-500">
          Las reuniones y visitas al cliente también son trabajo. Con tu calendario conectado, BackIO cuenta esas horas: te asigna menos
          tareas el día que tienes reuniones y las suma a la cuenta del cliente con el que te reuniste. Se conecta una sola vez.
        </p>
      </header>
      {params.get('google') === 'ok' && (
        <Alert tipo="ok">Listo: tu Google Calendar quedó conectado. Tus reuniones se cuentan en las próximas 2 horas.</Alert>
      )}
      {error && <Alert tipo="error">{error}</Alert>}
      {estado && !estado.configurado && (
        <Alert tipo="info">Todavía no está disponible: falta que administración termine de configurar Google en BackIO.</Alert>
      )}
      <section className="card p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-semibold text-lg">Tu calendario</div>
            <div className="text-sm text-gray-500">
              {estado?.conectado
                ? `Conectado como ${estado.email}${estado.conectado_at ? ` desde el ${new Date(estado.conectado_at).toLocaleDateString('es-EC')}` : ''}.`
                : 'Sin conectar. Tus reuniones de Google no cuentan todavía.'}
            </div>
          </div>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${estado?.conectado ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}
          >
            {estado ? (estado.conectado ? 'Conectado' : 'Sin conectar') : '…'}
          </span>
        </div>
        <div className="rounded-md bg-gray-50 p-3 text-xs text-gray-600 space-y-1">
          <p>
            <b>Qué lee BackIO:</b> la hora de inicio y fin de cada evento, si lo aceptaste y el dominio de los invitados externos (por
            ejemplo, el del cliente). Nada más.
          </p>
          <p>
            <b>Qué no lee nunca:</b> el título, la descripción, el lugar, las notas ni los correos de los invitados.
          </p>
          <p>Usa tu cuenta de trabajo: BackIO solo acepta el correo con el que entras aquí.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" disabled={busy || !estado?.configurado} onClick={conectar}>
            {busy ? 'Redirigiendo…' : estado?.conectado ? 'Volver a conectar' : 'Conectar mi Google Calendar'}
          </button>
          {estado?.conectado && (
            <button className="btn-ghost" disabled={busy} onClick={desconectar}>
              Desconectar
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

export default function MiGooglePage() {
  return (
    <Suspense>
      <Contenido />
    </Suspense>
  );
}
