'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ApiError } from '@/lib/api';
import { conectarMiBasecamp, leerMiBasecamp } from '@/lib/miBasecamp';

/**
 * Aviso para quien no conectó su Basecamp: sin conexión, BackIO no escribe en Basecamp a su nombre (crear tareas,
 * cambiar fechas, publicar el daily). Se oculta en la propia página de Mi Basecamp.
 */
export function AvisoBasecamp() {
  const pathname = usePathname();
  const [conectado, setConectado] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    leerMiBasecamp()
      .then((r) => setConectado(r.conectado))
      .catch(() => setConectado(null)); // si falla la consulta, no se molesta a nadie con el aviso
  }, [pathname]);

  if (conectado !== false || pathname.startsWith('/mi-basecamp')) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <span>
        <strong>Conecta tu Basecamp.</strong> Así lo que hagas aquí (crear tareas, cambiar fechas, publicar el daily) sale en Basecamp a tu
        nombre. Mientras no lo conectes, BackIO no escribe en Basecamp por ti.
      </span>
      <span className="flex items-center gap-3">
        {error && <span className="text-red-700">{error}</span>}
        <button
          className="btn-primary text-xs"
          onClick={() => conectarMiBasecamp().catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudo iniciar'))}
        >
          Conectar mi Basecamp
        </button>
      </span>
    </div>
  );
}
