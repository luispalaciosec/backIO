'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';

interface Tarea {
  id: string;
  titulo: string;
  descripcion: string;
  escribe: 'BackIO' | 'Basecamp';
}
interface Accion {
  id: string;
  tipo: 'dar_de_baja' | 'enlazar' | 'reenviar_responsables';
  cliente: string;
  titulo: string;
  motivo: string;
}
interface Resultado {
  aplicadas: number;
  omitidas: number;
  errores: { id: string; error: string }[];
}

const TIPO: Record<Accion['tipo'], string> = {
  dar_de_baja: 'Dar de baja',
  enlazar: 'Enlazar',
  reenviar_responsables: 'Reenviar responsables',
};
const MAX_BASECAMP = 50;

function TareaCard({ tarea }: { tarea: Tarea }) {
  const [acciones, setAcciones] = useState<Accion[] | null>(null);
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<'revisar' | 'aplicar' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const tope = tarea.escribe === 'Basecamp' ? MAX_BASECAMP : Infinity;

  async function revisar() {
    setBusy('revisar');
    setError(null);
    setResultado(null);
    try {
      const { items } = await api<{ items: Accion[] }>(`/admin/mantenimiento/${tarea.id}/revisar`, { method: 'POST' });
      setAcciones(items);
      setElegidas(new Set(items.slice(0, tope).map((a) => a.id)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo revisar');
    } finally {
      setBusy(null);
    }
  }

  async function aplicar() {
    const n = elegidas.size;
    const destino = tarea.escribe === 'Basecamp' ? 'en Basecamp' : 'en BackIO';
    if (!confirm(`¿Aplicar ${n} ${n === 1 ? 'cambio' : 'cambios'} ${destino}? Cada uno queda en la auditoría.`)) return;
    setBusy('aplicar');
    setError(null);
    try {
      setResultado(await api<Resultado>(`/admin/mantenimiento/${tarea.id}/aplicar`, { method: 'POST', json: { ids: [...elegidas] } }));
      setAcciones(null);
      setElegidas(new Set());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo aplicar');
    } finally {
      setBusy(null);
    }
  }

  function alternar(id: string) {
    setElegidas((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else if (n.size < tope) n.add(id);
      return n;
    });
  }

  return (
    <section className="card p-5 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-semibold text-lg">{tarea.titulo}</div>
          <p className="text-sm text-gray-500">{tarea.descripcion}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${tarea.escribe === 'Basecamp' ? 'bg-amber-100 text-amber-900' : 'bg-gray-100 text-gray-700'}`}
        >
          Escribe en {tarea.escribe}
        </span>
      </div>

      {error && <Alert tipo="error">{error}</Alert>}
      {resultado && (
        <Alert tipo={resultado.errores.length ? 'warn' : 'ok'}>
          {resultado.aplicadas} {resultado.aplicadas === 1 ? 'cambio aplicado' : 'cambios aplicados'}.
          {resultado.omitidas > 0 && ` ${resultado.omitidas} ya no hacían falta (alguien los cambió después de revisar).`}
          {resultado.errores.length > 0 && ` ${resultado.errores.length} fallaron: ${resultado.errores.map((e) => e.error).join(' · ')}`}
        </Alert>
      )}

      {acciones && acciones.length === 0 && <Alert tipo="ok">No hay nada que reparar.</Alert>}
      {acciones && acciones.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm text-gray-600">
            {acciones.length} {acciones.length === 1 ? 'cambio propuesto' : 'cambios propuestos'}. Desmarca los que no quieras aplicar.
            {acciones.length > tope && ` Basecamp admite ${tope} por vez: aplica y vuelve a revisar para seguir.`}
          </div>
          <div className="max-h-96 overflow-auto rounded border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500 sticky top-0">
                <tr>
                  <th className="p-2 w-8" />
                  <th className="p-2">Cliente</th>
                  <th className="p-2">Tarea</th>
                  <th className="p-2">Acción</th>
                  <th className="p-2">Por qué</th>
                </tr>
              </thead>
              <tbody>
                {acciones.map((a) => (
                  <tr key={a.id} className="border-t">
                    <td className="p-2">
                      <input
                        type="checkbox"
                        aria-label={`Aplicar a ${a.titulo}`}
                        checked={elegidas.has(a.id)}
                        onChange={() => alternar(a.id)}
                      />
                    </td>
                    <td className="p-2 whitespace-nowrap">{a.cliente}</td>
                    <td className="p-2">{a.titulo}</td>
                    <td className="p-2 whitespace-nowrap">{TIPO[a.tipo]}</td>
                    <td className="p-2 text-gray-500">{a.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button className="btn-secondary" disabled={busy !== null} onClick={revisar}>
          {busy === 'revisar' ? 'Revisando…' : acciones ? 'Revisar de nuevo' : 'Revisar'}
        </button>
        {acciones && acciones.length > 0 && (
          <button className="btn-primary" disabled={busy !== null || elegidas.size === 0} onClick={aplicar}>
            {busy === 'aplicar' ? 'Aplicando…' : `Aplicar ${elegidas.size}`}
          </button>
        )}
      </div>
    </section>
  );
}

export default function MantenimientoPage() {
  const [tareas, setTareas] = useState<Tarea[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ items: Tarea[] }>('/admin/mantenimiento')
      .then((r) => setTareas(r.items))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudieron cargar las tareas'));
  }, []);

  return (
    <div className="max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Mantenimiento</h1>
        <p className="text-sm text-gray-500">
          Reparaciones de datos. Revisar no cambia nada; aplicar ejecuta solo lo que marcaste y lo deja en la auditoría. Las bajas son
          lógicas: la fila no se borra de la base y queda registrada.
        </p>
      </header>
      {error && <Alert tipo="error">{error}</Alert>}
      {tareas?.map((t) => (
        <TareaCard key={t.id} tarea={t} />
      ))}
    </div>
  );
}
