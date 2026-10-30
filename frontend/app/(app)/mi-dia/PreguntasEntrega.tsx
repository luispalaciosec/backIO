'use client';
import { useCallback, useEffect, useState } from 'react';
import type { RequerimientoMetricas } from '@backio/shared';
import { MOTIVOS_REPROGRAMACION, hoyLocal } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { fecha } from '@/lib/format';
import { hrefExterno } from '@/lib/url';

type Modo = { id: string; tipo: 'entregado' | 'no_aun' } | null;

/**
 * «¿Ya se entregó?» (docs/22): tareas que pasaron su fecha y no se movieron. Se responde en un clic: entregada (con su
 * fecha; se cierra en Basecamp con tu cuenta), todavía no (nueva fecha y motivo) o espera al cliente.
 */
export function PreguntasEntrega({ clientes }: { clientes: Record<string, string> }) {
  const [items, setItems] = useState<RequerimientoMetricas[] | null>(null);
  const [modo, setModo] = useState<Modo>(null);
  const [fechaEntrega, setFechaEntrega] = useState('');
  const [nuevaFecha, setNuevaFecha] = useState('');
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const hoy = hoyLocal();

  const cargar = useCallback(async () => {
    try {
      setItems((await api<{ items: RequerimientoMetricas[] }>('/requerimientos/entregas/pendientes')).items);
    } catch (e) {
      setMsg({ tipo: 'error', texto: e instanceof ApiError ? e.message : 'No se pudieron cargar las tareas' });
      setItems([]);
    }
  }, []);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function enviar(r: RequerimientoMetricas, accion: () => Promise<string>) {
    setBusy(r.id);
    setMsg(null);
    try {
      setMsg({ tipo: 'ok', texto: await accion() });
      setModo(null);
      await cargar();
    } catch (e) {
      setMsg({ tipo: 'error', texto: e instanceof ApiError ? e.message : 'No se pudo guardar' });
    }
    setBusy(null);
  }
  const entregada = (r: RequerimientoMetricas) =>
    enviar(r, async () => {
      const x = await api<{ basecamp?: string; aviso?: string }>(`/requerimientos/${r.id}/entrega`, {
        method: 'POST',
        json: { respuesta: 'entregado', fecha: fechaEntrega },
      });
      return (
        x.aviso ??
        (x.basecamp === 'completado'
          ? `«${r.titulo_interno}» quedó entregada el ${fecha(fechaEntrega)} y se cerró en Basecamp con tu cuenta.`
          : `«${r.titulo_interno}» quedó entregada el ${fecha(fechaEntrega)}.`)
      );
    });
  const esperaCliente = (r: RequerimientoMetricas) =>
    enviar(r, async () => {
      await api(`/requerimientos/${r.id}/entrega`, { method: 'POST', json: { respuesta: 'espera_cliente' } });
      return `«${r.titulo_interno}» quedó esperando al cliente. Se avisó a la ejecutiva de la cuenta.`;
    });
  const reprogramar = (r: RequerimientoMetricas) =>
    enviar(r, async () => {
      await api(`/requerimientos/${r.id}`, { method: 'PATCH', json: { fecha_entrega: nuevaFecha, motivo_reprogramacion: motivo } });
      return `«${r.titulo_interno}» pasó al ${fecha(nuevaFecha)}.`;
    });

  if (items === null) return <section className="card p-4 text-sm text-gray-500">Cargando…</section>;
  return (
    <section className="card">
      <div className="px-4 py-3 border-b border-gray-200">
        <div className="font-semibold">¿Ya se entregó?</div>
        <p className="text-xs text-gray-500 mt-0.5">
          Tareas tuyas que pasaron su fecha y no se movieron. Si ya las entregaste, dilo aquí: cuenta la fecha real de entrega, no el día en
          que se cierra en Basecamp.
        </p>
      </div>
      {msg && (
        <p className={`px-4 pt-3 text-sm ${msg.tipo === 'ok' ? 'text-green-700' : 'text-red-600'}`} role="status">
          {msg.texto}
        </p>
      )}
      <ul className="divide-y divide-gray-100">
        {items.length === 0 && <li className="p-4 text-sm text-gray-500">No tienes tareas pendientes de confirmar. ¡Bien!</li>}
        {items.map((r) => {
          const abierto = modo?.id === r.id ? modo.tipo : null;
          return (
            <li key={r.id} className="p-4 text-sm space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  {r.basecamp_url ? (
                    <a
                      href={hrefExterno(r.basecamp_url)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium hover:underline break-words"
                    >
                      {r.titulo_interno}
                    </a>
                  ) : (
                    <span className="font-medium break-words">{r.titulo_interno}</span>
                  )}
                  <div className="text-xs text-gray-500">
                    {clientes[r.cliente_id] ?? ''} · vencía el {fecha(r.fecha_entrega)} · {r.dias_atraso} d de atraso ·{' '}
                    {r.dias_sin_movimiento} d sin movimiento
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn-success text-xs py-1"
                    disabled={!!busy}
                    onClick={() => {
                      setModo({ id: r.id, tipo: 'entregado' });
                      setFechaEntrega(r.fecha_entrega && r.fecha_entrega <= hoy ? r.fecha_entrega : hoy);
                    }}
                  >
                    Sí, ya se entregó
                  </button>
                  <button
                    className="btn-secondary text-xs py-1"
                    disabled={!!busy}
                    onClick={() => {
                      setModo({ id: r.id, tipo: 'no_aun' });
                      setNuevaFecha('');
                      setMotivo('');
                    }}
                  >
                    Todavía no
                  </button>
                  <button className="btn-ghost text-xs py-1" disabled={!!busy} onClick={() => esperaCliente(r)}>
                    {busy === r.id && !abierto ? 'Guardando…' : 'Espera al cliente'}
                  </button>
                </div>
              </div>
              {abierto === 'entregado' && (
                <div className="flex flex-wrap items-end gap-2 rounded-md bg-green-50 p-3">
                  <label className="text-xs">
                    <span className="label">¿Qué día la entregaste?</span>
                    <input
                      id={`entrega-${r.id}`}
                      type="date"
                      className="input"
                      max={hoy}
                      value={fechaEntrega}
                      onChange={(e) => setFechaEntrega(e.target.value)}
                    />
                  </label>
                  <button className="btn-primary text-xs" disabled={!fechaEntrega || !!busy} onClick={() => entregada(r)}>
                    {busy === r.id ? 'Guardando…' : 'Confirmar entrega'}
                  </button>
                  <button className="btn-ghost text-xs" onClick={() => setModo(null)}>
                    Cancelar
                  </button>
                  {r.basecamp_url && <p className="w-full text-xs text-gray-600">Se cerrará el to-do en Basecamp con tu cuenta.</p>}
                </div>
              )}
              {abierto === 'no_aun' && (
                <div className="flex flex-wrap items-end gap-2 rounded-md bg-gray-50 p-3">
                  <label className="text-xs">
                    <span className="label">Nueva fecha</span>
                    <input
                      id={`nueva-${r.id}`}
                      type="date"
                      className="input"
                      min={hoy}
                      value={nuevaFecha}
                      onChange={(e) => setNuevaFecha(e.target.value)}
                    />
                  </label>
                  <label className="text-xs">
                    <span className="label">Motivo</span>
                    <select id={`motivo-${r.id}`} className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
                      <option value="">Elige el motivo</option>
                      {MOTIVOS_REPROGRAMACION.map((x) => (
                        <option key={x.valor} value={x.valor}>
                          {x.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="btn-primary text-xs" disabled={!nuevaFecha || !motivo || !!busy} onClick={() => reprogramar(r)}>
                    {busy === r.id ? 'Guardando…' : 'Cambiar la fecha'}
                  </button>
                  <button className="btn-ghost text-xs" onClick={() => setModo(null)}>
                    Cancelar
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
