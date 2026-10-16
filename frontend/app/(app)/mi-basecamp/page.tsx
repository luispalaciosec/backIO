'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';
import { conectarMiBasecamp, leerMiBasecamp, type MiBasecamp } from '@/lib/miBasecamp';

function Contenido() {
  const params = useSearchParams();
  const [estado, setEstado] = useState<MiBasecamp | null>(null);
  const [error, setError] = useState<string | null>(params.get('basecamp') === 'error' ? params.get('motivo') : null);
  const [busy, setBusy] = useState(false);

  const cargar = () =>
    leerMiBasecamp()
      .then(setEstado)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudo leer tu conexión'));
  useEffect(() => {
    void cargar();
  }, []);

  async function conectar() {
    setBusy(true);
    setError(null);
    try {
      await conectarMiBasecamp();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo iniciar la conexión');
      setBusy(false);
    }
  }
  async function desconectar() {
    if (!confirm('¿Desconectar tu Basecamp? Mientras no lo vuelvas a conectar, BackIO no escribirá en Basecamp por ti.')) return;
    setBusy(true);
    try {
      await api('/basecamp/mi-cuenta', { method: 'DELETE' });
      await cargar();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo desconectar');
    }
    setBusy(false);
  }

  return (
    <div className="max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Mi Basecamp</h1>
        <p className="text-sm text-gray-500">
          Basecamp registra como autor a la cuenta que hace cada cambio. Con tu cuenta conectada, lo que haces desde BackIO (crear tareas,
          cambiar fechas, reabrir, publicar el daily o un acta) sale en Basecamp a tu nombre y avisa a la gente como si lo hubieras hecho
          allá. Se conecta una sola vez.
        </p>
      </header>
      {params.get('basecamp') === 'ok' && <Alert tipo="ok">Listo: tu Basecamp quedó conectado.</Alert>}
      {error && <Alert tipo="error">{error}</Alert>}
      <section className="card p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-semibold text-lg">Tu cuenta de Basecamp</div>
            <div className="text-sm text-gray-500">
              {estado?.conectado
                ? `Conectada${estado.email ? ` como ${estado.email}` : ''}${estado.conectado_at ? ` desde el ${new Date(estado.conectado_at).toLocaleDateString('es-EC')}` : ''}.`
                : 'Sin conectar. BackIO no escribe en Basecamp por ti hasta que la conectes.'}
            </div>
          </div>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${estado?.conectado ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}
          >
            {estado ? (estado.conectado ? 'Conectada' : 'Sin conectar') : '…'}
          </span>
        </div>
        <p className="text-xs text-gray-500">
          Entra a Basecamp con <strong>tu</strong> cuenta antes de conectar: BackIO solo acepta la cuenta que corresponde a tu usuario.
        </p>
        <div className="flex gap-2">
          <button className="btn-primary" disabled={busy || !estado} onClick={conectar}>
            {busy ? 'Redirigiendo…' : estado?.conectado ? 'Volver a conectar' : 'Conectar mi Basecamp'}
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

export default function MiBasecampPage() {
  return (
    <Suspense>
      <Contenido />
    </Suspense>
  );
}
