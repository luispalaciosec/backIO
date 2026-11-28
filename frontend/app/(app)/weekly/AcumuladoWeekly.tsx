'use client';
import { useCallback, useEffect, useState } from 'react';
import { hoyLocal, sumarDias } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { fecha } from '@/lib/format';
import { Alert } from '@/components/ui/Alert';
import { hrefExterno } from '@/lib/url';

type Estado = 'terminada' | 'revision' | 'ajustes' | 'no_cumplida' | 'nueva' | 'en_curso';
type Color = 'verde' | 'amarillo' | 'rojo';
interface Conteo {
  total: number;
  piezas: number;
  por_estado: Record<Estado, number>;
  cerradas_plan: number;
  para_entregar: number;
  cumplimiento_pct: number | null;
  semaforo: Color | null;
}
interface Tarea {
  id: string;
  estado: Estado;
  cliente: string;
  titulo: string;
  url: string | null;
  fecha: string | null;
  piezas: number;
  con_ayuda_de: string[];
}
interface Persona extends Conteo {
  usuario_id: string;
  nombre: string;
  tareas: Tarea[];
}
interface Equipo extends Conteo {
  nombre: string;
  participacion_piezas_pct: number | null;
  personas: Persona[];
}
interface Acumulado {
  mesa: { id: string; nombre: string };
  semana: { inicio: string; fin: string; dias_medidos: string[] };
  resumen: Conteo;
  equipos: Equipo[];
  estados: { estado: Estado; icono: string; etiqueta: string }[];
  publicado: { url: string | null; at: string } | null;
}

const COLOR: Record<Color, { texto: string; fondo: string; bola: string; nombre: string }> = {
  verde: { texto: 'text-emerald-700', fondo: 'bg-emerald-50 border-emerald-200', bola: 'bg-emerald-500', nombre: 'Verde' },
  amarillo: { texto: 'text-amber-700', fondo: 'bg-amber-50 border-amber-200', bola: 'bg-amber-400', nombre: 'Amarillo' },
  rojo: { texto: 'text-red-700', fondo: 'bg-red-50 border-red-200', bola: 'bg-red-500', nombre: 'Rojo' },
};

function Cumplimiento({ c, grande = false }: { c: Conteo; grande?: boolean }) {
  if (c.cumplimiento_pct === null) return <span className="text-gray-400">—</span>;
  const k = COLOR[c.semaforo ?? 'rojo'];
  return (
    <span className={`inline-flex items-center gap-1.5 font-semibold tabular-nums ${k.texto} ${grande ? 'text-3xl' : ''}`}>
      <span className={`inline-block rounded-full ${k.bola} ${grande ? 'h-3 w-3' : 'h-2 w-2'}`} aria-hidden />
      {c.cumplimiento_pct}%<span className="sr-only"> ({k.nombre})</span>
    </span>
  );
}

/**
 * Weekly acumulado (vista de la ejecutiva de Orión, 27/11): todo lo de la semana por equipo y persona, con el estado y las
 * piezas de cada tarea. El cumplimiento es el mismo del cierre del daily, sumado por día hábil.
 */
export function AcumuladoWeekly({ mesaId, dia, puedePublicar }: { mesaId: string; dia: string | null; puedePublicar: boolean }) {
  const [d, setD] = useState<Acumulado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const cargar = useCallback(async () => {
    setError(null);
    try {
      const r = await api<Acumulado>(`/semanas/acumulado?mesa=${mesaId}${dia ? `&dia=${dia}` : ''}`);
      setD(r);
      setAbiertos(new Set(r.equipos.map((e) => e.nombre)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo cargar el acumulado');
    }
  }, [mesaId, dia]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (error) return <Alert tipo="error">{error}</Alert>;
  if (!d) return <p className="text-sm text-gray-500">Armando la semana…</p>;

  const r = d.resumen;
  const icono = Object.fromEntries(d.estados.map((e) => [e.estado, e]));
  const actual = d.semana.inicio <= hoyLocal() && hoyLocal() <= d.semana.fin;
  const ir = (n: number) => `/weekly?mesa=${mesaId}&vista=acumulado&dia=${sumarDias(d.semana.inicio, n)}`;
  const estadosConDatos = d.estados.filter((e) => r.por_estado[e.estado]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <a className="btn-ghost text-sm py-1" href={ir(-7)} aria-label="Semana anterior">
            ← Anterior
          </a>
          <span className="font-medium">
            {fecha(d.semana.inicio)} – {fecha(d.semana.fin)}
            {actual && <span className="ml-1.5 text-xs text-sky-700">en curso</span>}
          </span>
          {!actual && (
            <a className="btn-ghost text-sm py-1" href={ir(7)} aria-label="Semana siguiente">
              Siguiente →
            </a>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <button type="button" className="btn-secondary text-sm" onClick={() => window.print()}>
            Imprimir
          </button>
          {puedePublicar && <Publicar mesaId={mesaId} dia={d.semana.inicio} publicado={d.publicado} onPublicado={cargar} />}
        </div>
      </div>

      <section className={`card p-5 border ${r.semaforo ? COLOR[r.semaforo].fondo : ''}`} aria-label="Resumen de la semana">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">Cumplimiento</div>
            <Cumplimiento c={r} grande />
            <div className="text-xs text-gray-500 tabular-nums">
              {r.cerradas_plan} de {r.para_entregar} entregas comprometidas
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">Tareas de la semana</div>
            <div className="text-3xl font-semibold tabular-nums">{r.total}</div>
            <div className="text-xs text-gray-500">{r.por_estado.terminada} terminadas</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">Piezas realizadas</div>
            <div className="text-3xl font-semibold tabular-nums">{r.piezas}</div>
            <div className="text-xs text-gray-500">terminadas y entregadas al cliente</div>
          </div>
        </div>
        <ul className="mt-4 flex flex-wrap gap-2 text-sm" aria-label="Conteo por estado">
          {estadosConDatos.map((e) => (
            <li key={e.estado} className="rounded-md bg-white/70 border border-gray-200 px-2.5 py-1 tabular-nums">
              {e.icono} {e.etiqueta}: <b>{r.por_estado[e.estado]}</b>
              <span className="text-gray-500"> · {Math.round((r.por_estado[e.estado] / Math.max(1, r.total)) * 100)}%</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-gray-500">
          Misma medición del cierre del daily: entregas cerradas ÷ entregas comprometidas cada día. Lo que se entrega otro día no cuenta en
          contra. Verde desde 90 %, amarillo desde 70 %.
        </p>
      </section>

      {d.equipos.map((e) => {
        const abierto = abiertos.has(e.nombre);
        return (
          <section key={e.nombre} className="card overflow-hidden" aria-label={`Equipo ${e.nombre}`}>
            <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">{e.nombre}</h2>
                <p className="text-xs text-gray-500 tabular-nums">
                  {e.total} tareas · {e.piezas} piezas
                  {e.participacion_piezas_pct !== null && ` · ${e.participacion_piezas_pct}% de las piezas`}
                </p>
              </div>
              <Cumplimiento c={e} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th">Persona</th>
                    {d.estados.map((s) => (
                      <th key={s.estado} className="th text-center" title={s.etiqueta}>
                        <span aria-hidden>{s.icono}</span>
                        <span className="sr-only">{s.etiqueta}</span>
                      </th>
                    ))}
                    <th className="th text-center">Total</th>
                    <th className="th text-center">Piezas</th>
                    <th className="th text-center">Cumplimiento</th>
                  </tr>
                </thead>
                <tbody>
                  {e.personas.map((p) => (
                    <tr key={p.usuario_id} className="border-t border-gray-100">
                      <td className="td font-medium">{p.nombre}</td>
                      {d.estados.map((s) => (
                        <td key={s.estado} className="td text-center tabular-nums text-gray-700">
                          {p.por_estado[s.estado] || <span className="text-gray-300">0</span>}
                        </td>
                      ))}
                      <td className="td text-center tabular-nums font-semibold">{p.total}</td>
                      <td className="td text-center tabular-nums">{p.piezas}</td>
                      <td className="td text-center">
                        <Cumplimiento c={p} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              className="w-full px-4 py-2 text-left text-sm text-brand hover:bg-gray-50 border-t border-gray-100 print:hidden"
              aria-expanded={abierto}
              onClick={() =>
                setAbiertos((s) => {
                  const n = new Set(s);
                  if (n.has(e.nombre)) n.delete(e.nombre);
                  else n.add(e.nombre);
                  return n;
                })
              }
            >
              {abierto ? 'Ocultar tareas' : 'Ver tareas'}
            </button>
            {abierto && (
              <div className="px-4 pb-4 space-y-4">
                {e.personas.map((p) => (
                  <div key={p.usuario_id}>
                    <div className="text-sm font-medium">
                      {p.nombre} <span className="text-gray-500 font-normal">· {p.tareas.length} tareas</span>
                    </div>
                    <ul className="mt-1 space-y-1 text-sm">
                      {p.tareas.map((t) => (
                        <li key={t.id} className="flex gap-2">
                          <span aria-hidden className="shrink-0">
                            {icono[t.estado]?.icono}
                          </span>
                          <span className="min-w-0">
                            <span className="sr-only">{icono[t.estado]?.etiqueta}: </span>
                            {t.url ? (
                              <a href={hrefExterno(t.url)} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                                {t.titulo}
                              </a>
                            ) : (
                              t.titulo
                            )}
                            <span className="text-gray-500">
                              {' '}
                              · {t.cliente}
                              {t.fecha && ` · ${fecha(t.fecha)}`}
                              {t.con_ayuda_de.length > 0 && ` · con ayuda de ${t.con_ayuda_de.join(', ')}`}
                            </span>
                            {t.piezas > 0 && (
                              <span className="ml-1 text-red-700 tabular-nums">
                                ({t.piezas} {t.piezas === 1 ? 'pieza' : 'piezas'})
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}

      {d.equipos.length === 0 && <p className="text-sm text-gray-500">No hubo tareas de esta mesa en la semana.</p>}
      {d.equipos.length === 1 && d.equipos[0]!.nombre === 'Sin equipo' && (
        <p className="text-xs text-gray-500 print:hidden">
          Para verlo por equipo (por ejemplo, KKAA y OFF), asigna el equipo de cada cliente en Admin → Clientes.
        </p>
      )}
    </div>
  );
}

function Publicar({
  mesaId,
  dia,
  publicado,
  onPublicado,
}: {
  mesaId: string;
  dia: string;
  publicado: Acumulado['publicado'];
  onPublicado: () => Promise<void>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [url, setUrl] = useState('');
  const [html, setHtml] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string; url?: string } | null>(null);
  const cuerpo = (otraVez = false) => ({ mesa_id: mesaId, dia, mensaje_url: url.trim(), otra_vez: otraVez });
  async function verPrevia() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ html: string }>('/semanas/acumulado/vista-previa', { method: 'POST', json: cuerpo() });
      setHtml(r.html);
    } catch (e) {
      setMsg({ ok: false, texto: e instanceof ApiError ? e.message : 'No se pudo armar la vista previa' });
    }
    setBusy(false);
  }
  async function publicar() {
    setBusy(true);
    try {
      const r = await api<{ url: string }>('/semanas/acumulado/publicar', { method: 'POST', json: cuerpo(!!publicado) });
      setMsg({ ok: true, texto: 'Publicado como comentario en Basecamp.', url: r.url });
      setHtml(null);
      setAbierto(false);
      await onPublicado();
    } catch (e) {
      setMsg({ ok: false, texto: e instanceof ApiError ? e.message : 'No se pudo publicar' });
    }
    setBusy(false);
  }
  return (
    <>
      <button type="button" className="btn-primary text-sm" onClick={() => setAbierto((x) => !x)}>
        {publicado ? 'Publicar de nuevo' : 'Publicar en Basecamp'}
      </button>
      {publicado && !abierto && (
        <span className="text-xs text-gray-500">
          Publicado{' '}
          {publicado.url ? (
            <a className="text-brand hover:underline" href={hrefExterno(publicado.url)} target="_blank" rel="noreferrer">
              en Basecamp
            </a>
          ) : (
            'en Basecamp'
          )}
        </span>
      )}
      {msg && (
        <span className={`text-xs ${msg.ok ? 'text-green-700' : 'text-red-600'}`} role="status">
          {msg.texto}{' '}
          {msg.url && (
            <a className="text-brand hover:underline" href={hrefExterno(msg.url)} target="_blank" rel="noreferrer">
              Ver
            </a>
          )}
        </span>
      )}
      {abierto && (
        <div
          className="fixed inset-0 bg-black/40 flex items-stretch justify-center p-2 sm:p-6 z-50"
          onClick={() => !busy && setAbierto(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Publicar el acumulado en Basecamp"
            className="bg-white rounded-lg shadow-xl w-full max-w-3xl flex flex-col min-h-0"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-gray-200 space-y-2">
              <div className="font-semibold">Publicar el acumulado como comentario</div>
              <label className="label" htmlFor="mensaje-url">
                Enlace del mensaje de Basecamp donde va el comentario (por ejemplo, el Status Semanal del lunes)
              </label>
              <div className="flex gap-2">
                <input
                  id="mensaje-url"
                  className="input flex-1"
                  placeholder="https://3.basecamp.com/…/buckets/…/messages/…"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setHtml(null);
                  }}
                />
                <button type="button" className="btn-secondary" disabled={busy || !url.trim()} onClick={verPrevia}>
                  {busy && !html ? 'Armando…' : 'Vista previa'}
                </button>
              </div>
              <p className="text-xs text-gray-500">Sale a tu nombre y avisa a quienes siguen ese mensaje.</p>
            </div>
            {html ? (
              <iframe
                title="Vista previa del comentario"
                sandbox=""
                className="flex-1 min-h-[16rem] w-full"
                srcDoc={`<!doctype html><meta charset="utf-8"><body style="font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1f2937;margin:16px 20px">${html}</body>`}
              />
            ) : (
              <p className="p-5 text-sm text-gray-500 flex-1">
                Pega el enlace y pulsa «Vista previa» para ver el comentario antes de publicarlo.
              </p>
            )}
            {msg && !msg.ok && <p className="px-5 pb-2 text-sm text-red-600">{msg.texto}</p>}
            <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => setAbierto(false)}>
                Volver
              </button>
              <button type="button" className="btn-primary" disabled={busy || !html} onClick={publicar}>
                {busy && html ? 'Publicando…' : publicado ? 'Publicar de nuevo' : 'Publicar comentario'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
