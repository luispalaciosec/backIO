'use client';
import { useCallback, useEffect, useState } from 'react';
import type { RequerimientoMetricas } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { useIA } from '@/lib/useIA';

export type Razon =
  | 'ya_elegida'
  | 'vence_hoy'
  | 'vence_manana'
  | 'atrasada'
  | 'del_ultimo_daily'
  | 'compromiso_weekly'
  | 'en_curso'
  | 'urgente'
  | 'cliente_rojo'
  | 'cliente_amarillo';
export const ETIQUETA_RAZON: Record<Razon, string> = {
  ya_elegida: 'Ya elegida',
  vence_hoy: 'Vence hoy',
  vence_manana: 'Vence mañana',
  atrasada: 'Atrasada',
  del_ultimo_daily: 'Del último daily',
  compromiso_weekly: 'Compromiso del weekly',
  en_curso: 'En curso',
  urgente: 'Urgente',
  cliente_rojo: 'Cliente en rojo',
  cliente_amarillo: 'Cliente en amarillo',
};
export interface Sugerencia {
  id: string;
  titulo: string;
  para_que: string;
  recomendado: boolean;
  tareas: { id: string; razones: Razon[] }[];
  impacto: {
    tareas: number;
    nuevas: number;
    atraso_antes: number;
    atraso_despues: number;
    vencen_hoy: number;
    vencen_hoy_cubiertas: number;
    afuera: number;
    afuera_por_cliente: { cliente_id: string; n: number }[];
    personas: { usuario_id: string; horas: number; capacidad: number }[];
  };
}
interface Datos {
  escenarios: Sugerencia[];
  porque: string;
  sigue_viva: { id: string; dias_atraso: number; dias_sin_movimiento: number }[];
}

const h = (n: number) => `${n.toLocaleString('es-EC', { maximumFractionDigits: 1 })} h`;

/**
 * Escenarios para armar el día (docs/05): las reglas proponen tres formas de elegir las tareas de hoy y recomiendan una.
 * Nada se marca sin un clic, se puede mirar antes de aplicar y se puede deshacer.
 */
export function Recomendaciones({
  mesa,
  yo,
  tieneCuentas,
  items,
  nombreCliente,
  nombrePersona,
  ocupado,
  viendo,
  onVer,
  onMarcar,
  hoy,
}: {
  mesa: string;
  yo: string | null;
  tieneCuentas: boolean;
  items: RequerimientoMetricas[];
  nombreCliente: (id: string) => string;
  nombrePersona: (id: string) => string;
  ocupado: boolean;
  viendo: string | null;
  onVer: (e: Sugerencia | null) => void;
  onMarcar: (ids: string[], dia: string | null) => Promise<void>;
  hoy: string;
}) {
  const ia = useIA();
  const [abierto, setAbierto] = useState(true);
  const [soloMias, setSoloMias] = useState(false);
  const [d, setD] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aplicado, setAplicado] = useState<{ titulo: string; ids: string[] } | null>(null);
  const [explicacion, setExplicacion] = useState<string | null>(null);
  const [explicando, setExplicando] = useState(false);
  const [preguntadas, setPreguntadas] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const q = new URLSearchParams();
      if (mesa) q.set('mesa', mesa);
      if (soloMias) q.set('solo_mias', '1');
      setD(await api<Datos>(`/semanas/daily/escenarios?${q}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudieron calcular las recomendaciones');
    }
  }, [mesa, soloMias]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function aplicar(e: Sugerencia) {
    const ids = e.tareas.filter((t) => !t.razones.includes('ya_elegida')).map((t) => t.id);
    await onMarcar(ids, hoy);
    setAplicado({ titulo: e.titulo, ids });
    onVer(null);
    await cargar();
  }
  async function deshacer() {
    if (!aplicado) return;
    await onMarcar(aplicado.ids, null);
    setAplicado(null);
    await cargar();
  }
  async function explicar() {
    setExplicando(true);
    try {
      setExplicacion(
        (await api<{ texto: string }>('/ia/daily-escenario', { method: 'POST', json: { mesa_id: mesa || null, solo_mias: soloMias } }))
          .texto,
      );
    } catch (e) {
      setExplicacion(e instanceof ApiError ? e.message : 'No se pudo redactar la explicación');
    }
    setExplicando(false);
  }
  async function preguntar() {
    if (!d?.sigue_viva.length) return;
    try {
      const r = await api<{ personas: number; tareas: number }>('/semanas/daily/preguntar-vivas', {
        method: 'POST',
        json: { ids: d.sigue_viva.slice(0, 100).map((x) => x.id) },
      });
      setPreguntadas(
        `Se les preguntó a ${r.personas} ${r.personas === 1 ? 'persona' : 'personas'} por ${r.tareas} tareas. Lo responden en Mi día.`,
      );
    } catch (e) {
      setPreguntadas(e instanceof ApiError ? e.message : 'No se pudo preguntar');
    }
  }

  const titulo = (id: string) => items.find((r) => r.id === id)?.titulo_interno ?? '';
  return (
    <section className="border-b border-gray-200 bg-gray-50/60">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
        <button className="text-sm font-semibold" aria-expanded={abierto} onClick={() => setAbierto((x) => !x)}>
          {abierto ? '▾' : '▸'} Recomendaciones para hoy
        </button>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {tieneCuentas && yo && (
            <label className="flex items-center gap-1 text-gray-600">
              <input type="checkbox" checked={soloMias} onChange={(e) => setSoloMias(e.target.checked)} /> Solo mis cuentas
            </label>
          )}
          {ia && abierto && d?.escenarios.length ? (
            <button className="underline text-brand-dark disabled:opacity-50" disabled={explicando} onClick={explicar}>
              {explicando ? 'Redactando…' : '✨ Explicar la recomendación'}
            </button>
          ) : null}
        </div>
      </div>
      {abierto && (
        <div className="px-4 pb-3 space-y-2">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!d && !error && <p className="text-sm text-gray-500">Calculando…</p>}
          {d && (
            <>
              <p className="text-xs text-gray-600">{explicacion ?? d.porque}</p>
              {aplicado && (
                <p className="text-sm text-green-700" role="status">
                  Se aplicó «{aplicado.titulo}»: {aplicado.ids.length} tareas nuevas. Ajústalo abajo o{' '}
                  <button className="underline font-semibold" disabled={ocupado} onClick={deshacer}>
                    deshazlo
                  </button>
                  .
                </p>
              )}
              <div className="grid gap-2 md:grid-cols-3">
                {d.escenarios.map((e) => {
                  const i = e.impacto;
                  const pasadas = i.personas.filter((p) => p.capacidad > 0 && p.horas > p.capacidad);
                  return (
                    <article
                      key={e.id}
                      className={`rounded-md border bg-white p-3 text-xs space-y-1.5 ${e.recomendado ? 'border-brand ring-1 ring-brand/30' : 'border-gray-200'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{e.titulo}</span>
                        {e.recomendado && (
                          <span className="rounded-full bg-brand text-white px-2 text-[10px] font-semibold">Recomendado</span>
                        )}
                      </div>
                      <p className="text-gray-500">{e.para_que}</p>
                      <ul className="space-y-0.5 text-gray-700 tabular-nums">
                        <li>
                          <b>{i.tareas}</b> tareas{i.nuevas !== i.tareas ? ` (${i.nuevas} nuevas)` : ''}
                        </li>
                        {i.vencen_hoy > 0 && (
                          <li>
                            Cubre {i.vencen_hoy_cubiertas} de {i.vencen_hoy} que vencen hoy
                          </li>
                        )}
                        {i.atraso_antes > 0 && (
                          <li>
                            Atraso vivo: de {i.atraso_antes} a {i.atraso_despues}
                          </li>
                        )}
                        {i.afuera > 0 && (
                          <li className="text-gray-500">
                            Quedan afuera {i.afuera}
                            {i.afuera_por_cliente[0]
                              ? `, ${i.afuera_por_cliente[0].n} de ${nombreCliente(i.afuera_por_cliente[0].cliente_id)}`
                              : ''}
                          </li>
                        )}
                        <li className={pasadas.length ? 'text-red-700' : 'text-gray-500'}>
                          {pasadas.length
                            ? pasadas
                                .map((p) => `${nombrePersona(p.usuario_id).split(' ')[0]} ${h(p.horas)} de ${h(p.capacidad)}`)
                                .join(' · ')
                            : 'Nadie se pasa de sus horas'}
                        </li>
                      </ul>
                      <div className="flex gap-2 pt-1">
                        <button
                          className={`text-xs py-1 ${e.recomendado ? 'btn-primary' : 'btn-secondary'}`}
                          disabled={ocupado || i.nuevas === 0}
                          onClick={() => aplicar(e)}
                        >
                          {i.nuevas > 0 ? `Aplicar (${i.nuevas})` : i.tareas > 0 ? 'Ya aplicado' : 'No hay horas libres'}
                        </button>
                        <button
                          className="btn-ghost text-xs py-1"
                          aria-pressed={viendo === e.id}
                          onClick={() => onVer(viendo === e.id ? null : e)}
                        >
                          {viendo === e.id ? 'Ver todas' : 'Ver tareas'}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
              {d.sigue_viva.length > 0 && (
                <details className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs">
                  <summary className="cursor-pointer font-semibold text-amber-900">
                    ¿Siguen vivas? {d.sigue_viva.length} atrasadas sin moverse hace más de una semana: no se sugieren, quizá ya se
                    entregaron
                  </summary>
                  <div className="mt-2 space-y-2">
                    {preguntadas ? (
                      <p className="text-amber-900" role="status">
                        {preguntadas}
                      </p>
                    ) : (
                      <button className="btn-secondary text-xs py-1" onClick={preguntar}>
                        Preguntar a sus responsables (a su campana)
                      </button>
                    )}
                    <ul className="max-h-32 overflow-auto space-y-0.5 text-gray-700">
                      {d.sigue_viva.map((x) => (
                        <li key={x.id}>
                          {titulo(x.id)} · {x.dias_atraso} d de atraso · {x.dias_sin_movimiento} d quieta
                        </li>
                      ))}
                    </ul>
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
