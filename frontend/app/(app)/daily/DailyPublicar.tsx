'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { horaLocal } from '@backio/shared';
import { useIA } from '@/lib/useIA';
import { hrefExterno } from '@/lib/url';

type Tipo = 'apertura' | 'cierre';
interface Persona {
  usuario_id: string;
  nombre: string;
  cuentas: number;
  tareas_hoy: number;
  notas: string[];
  listo_at: string | null;
}
interface Estado {
  personas: Persona[];
  publicacion: { hora: string; por: string; url: string | null; agregados: number } | null;
  yo: string | null;
}
interface Vista {
  modo: 'publicar' | 'agregar';
  asunto: string;
  html: string;
  nada_nuevo: boolean;
  avisos: string[];
  avisados: number | null;
  hora_publicada?: string;
}

const ETIQUETA: Record<Tipo, { la: string; nombre: string }> = {
  apertura: { la: 'la apertura', nombre: 'Apertura' },
  cierre: { la: 'el cierre', nombre: 'Cierre' },
};
const primerNombre = (s: string) => s.split(' ')[0] ?? s;
const lineas = (t: string) =>
  t
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Paso 3 del daily, compartido entre las ejecutivas de la mesa: cada una deja sus notas y ve cómo van las demás, sin esperar
 * a nadie. Publicar abre el mensaje real y un clic lo envía; si ya salió, lo nuevo se agrega como comentario del mismo mensaje.
 */
export function DailyPublicar({ mesa, mesaNombre, tieneBoard }: { mesa: string; mesaNombre: string; tieneBoard: boolean }) {
  const ia = useIA();
  // Por la tarde lo normal es cerrar: la pantalla arranca en el que toca y se puede cambiar.
  const [tipo, setTipo] = useState<Tipo>(() => (horaLocal(new Date().toISOString()) >= '14:00' ? 'cierre' : 'apertura'));
  const [estado, setEstado] = useState<Estado | null>(null);
  const [notas, setNotas] = useState('');
  const [narrativa, setNarrativa] = useState<string | null>(null);
  const [narrativaTipo, setNarrativaTipo] = useState<Tipo | null>(null);
  const [vista, setVista] = useState<Vista | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error' | 'info'; texto: string; url?: string } | null>(null);

  const puede = !!mesa && tieneBoard;
  const cargar = useCallback(
    async (alCambiar = false) => {
      if (!puede) return;
      try {
        const e = await api<Estado>(`/semanas/daily/preparacion?mesa=${mesa}&tipo=${tipo}`);
        setEstado(e);
        // Las notas propias se cargan al abrir o al cambiar de tipo; luego no se pisa lo que se está escribiendo.
        if (alCambiar) setNotas((e.personas.find((p) => p.usuario_id === e.yo)?.notas ?? []).join('\n'));
      } catch {
        // Sin el estado se puede publicar igual: es información.
      }
    },
    [mesa, tipo, puede],
  );
  useEffect(() => {
    void cargar(true);
  }, [cargar]);
  useEffect(() => {
    const recargar = () => void cargar();
    const t = window.setInterval(recargar, 60_000);
    window.addEventListener('focus', recargar);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('focus', recargar);
    };
  }, [cargar]);

  if (!mesa) return <span className="text-xs text-gray-400">Elige una mesa arriba para redactar y publicar su apertura o cierre.</span>;
  if (!tieneBoard)
    return (
      <span className="text-xs text-gray-400">
        {mesaNombre} no tiene board Daily configurado (Admin → Mesas), así que no se puede publicar desde aquí.
      </span>
    );

  const yo = estado?.yo ?? null;
  const mia = estado?.personas.find((p) => p.usuario_id === yo);
  const otras = estado?.personas.filter((p) => p.usuario_id !== yo) ?? [];
  const publicada = estado?.publicacion ?? null;
  const notasDeOtras = otras.flatMap((p) => p.notas.map((n) => `${primerNombre(p.nombre)}: ${n}`));

  /** Guarda mis notas si cambiaron. Si no se puede (por ejemplo, una API key), siguen en el campo. */
  async function guardarNotas() {
    if (!yo) return;
    if (lineas(notas).join('\n') === (mia?.notas ?? []).join('\n')) return;
    setEstado(
      await api<Estado>('/semanas/daily/preparacion', {
        method: 'PUT',
        json: { mesa_id: mesa, tipo, notas: lineas(notas) },
      }),
    );
  }
  async function marcarLista(listo: boolean) {
    setBusy('lista');
    try {
      await guardarNotas();
      setEstado(await api<Estado>('/semanas/daily/preparacion', { method: 'PUT', json: { mesa_id: mesa, tipo, listo } }));
    } catch (e) {
      setMsg({ tipo: 'error', texto: e instanceof ApiError ? e.message : 'No se pudo guardar' });
    }
    setBusy(null);
  }
  async function redactar() {
    setBusy('ia');
    setMsg(null);
    try {
      const r = await api<{
        texto: string;
        resumen: { hoy: number; vencen: number; atrasadas?: number; bloqueos: number; cambios: number; completadas?: number };
      }>('/ia/daily', { method: 'POST', json: { mesa_id: mesa, tipo, notas: [...lineas(notas), ...notasDeOtras] } });
      setNarrativa(r.texto);
      setNarrativaTipo(tipo);
      setMsg({
        tipo: 'info',
        texto: `Borrador de ${tipo} listo: ${tipo === 'cierre' ? `${r.resumen.completadas ?? 0} completadas hoy, ${r.resumen.hoy} quedaron abiertas` : `${r.resumen.hoy} para hoy`}, ${r.resumen.vencen} vencen, ${r.resumen.atrasadas ?? 0} atrasadas sin iniciar, ${r.resumen.bloqueos} bloqueos, ${r.resumen.cambios} cambios. Edítalo y luego publica.`,
      });
    } catch (e) {
      setMsg({ tipo: 'error', texto: e instanceof ApiError ? e.message : 'No se pudo redactar' });
    }
    setBusy(null);
  }
  const borradorValido = narrativaTipo === tipo ? (narrativa ?? undefined) : undefined;
  async function abrirVista() {
    setBusy('vista');
    setMsg(null);
    try {
      await guardarNotas();
      setVista(
        await api<Vista>('/semanas/daily/vista-previa', {
          method: 'POST',
          json: { mesa_id: mesa, tipo, narrativa: borradorValido, notas: yo ? [] : lineas(notas) },
        }),
      );
    } catch (e) {
      setMsg({ tipo: 'error', texto: e instanceof ApiError ? e.message : 'No se pudo armar el mensaje' });
    }
    setBusy(null);
  }
  async function enviar() {
    if (!vista) return;
    setBusy('enviar');
    try {
      const r = await api<{
        url: string;
        agregado?: boolean;
        resumen: { hoy: number; vencen: number; atrasadas?: number; bloqueos: number; cambios: number; completadas?: number };
      }>('/semanas/daily/publicar', {
        method: 'POST',
        json: {
          mesa_id: mesa,
          tipo,
          narrativa: borradorValido,
          notas: yo ? [] : lineas(notas),
          agregar: vista.modo === 'agregar',
        },
      });
      setVista(null);
      setMsg({
        tipo: 'ok',
        texto: r.agregado
          ? `Agregado a ${ETIQUETA[tipo].la} en el mismo mensaje de Basecamp.`
          : `${ETIQUETA[tipo].nombre} publicado en Basecamp: ${tipo === 'cierre' ? `${r.resumen.completadas ?? 0} completadas hoy, ${r.resumen.hoy} quedaron abiertas` : `${r.resumen.hoy} para hoy`}, ${r.resumen.vencen} vencen, ${r.resumen.atrasadas ?? 0} atrasadas sin iniciar, ${r.resumen.bloqueos} bloqueos, ${r.resumen.cambios} cambios.`,
        url: r.url,
      });
      setNarrativa(null);
      setNarrativaTipo(null);
      await cargar();
    } catch (e) {
      // Otra persona publicó mientras esta veía la vista previa: se muestra lo que falta agregar.
      if (e instanceof ApiError && e.status === 409) {
        await cargar();
        setVista(
          await api<Vista>('/semanas/daily/vista-previa', {
            method: 'POST',
            json: { mesa_id: mesa, tipo, notas: yo ? [] : lineas(notas) },
          }),
        );
        setMsg({ tipo: 'info', texto: `Alguien publicó ${ETIQUETA[tipo].la} hace un momento. Esto es lo que falta agregar.` });
      } else {
        setVista(null);
        setMsg({ tipo: 'error', texto: e instanceof ApiError ? e.message : 'No se pudo publicar' });
      }
    }
    setBusy(null);
  }

  return (
    <div className="flex flex-col gap-2 w-full lg:w-auto">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-gray-300 overflow-hidden text-sm" role="group" aria-label="Qué se publica">
          {(['apertura', 'cierre'] as const).map((t) => (
            <button
              key={t}
              aria-pressed={tipo === t}
              className={`px-3 py-1.5 ${tipo === t ? 'bg-brand text-white font-medium' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
              onClick={() => {
                void guardarNotas().catch(() => undefined);
                setTipo(t);
                setMsg(null);
              }}
            >
              {ETIQUETA[t].nombre}
            </button>
          ))}
        </div>
        <textarea
          className="input w-72 py-1.5 text-sm"
          rows={1}
          placeholder={`Mis notas para ${ETIQUETA[tipo].la} (una por línea)`}
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          onBlur={() => void guardarNotas().catch(() => undefined)}
        />
        {yo && (
          <label className="text-sm flex items-center gap-1.5 cursor-pointer select-none">
            <input type="checkbox" checked={!!mia?.listo_at} disabled={!!busy} onChange={(e) => void marcarLista(e.target.checked)} />
            Mi parte está lista
          </label>
        )}
        {ia && !publicada && (
          <button
            className="btn-secondary"
            disabled={!!busy}
            onClick={redactar}
            title="La IA redacta con los datos del daily; tú lo editas y publicas"
          >
            {busy === 'ia' ? 'Redactando…' : `✨ Redactar ${tipo}`}
          </button>
        )}
        <button className={tipo === 'apertura' ? 'btn-success' : 'btn-danger'} disabled={!!busy} onClick={abrirVista}>
          {busy === 'vista' ? 'Armando el mensaje…' : publicada ? `Agregar a ${ETIQUETA[tipo].la}` : `Revisar y publicar ${tipo}`}
        </button>
      </div>

      {estado && (otras.length > 0 || publicada) && (
        <div className="text-xs text-gray-600 flex flex-wrap items-center gap-x-3 gap-y-1">
          {publicada && (
            <span className="font-medium text-green-800">
              Publicada a las {publicada.hora} por {primerNombre(publicada.por)}
              {publicada.agregados ? ` · ${publicada.agregados} ${publicada.agregados === 1 ? 'agregado' : 'agregados'}` : ''}
              {publicada.url && (
                <>
                  {' · '}
                  <a className="underline" href={hrefExterno(publicada.url)} target="_blank" rel="noreferrer">
                    Ver ↗
                  </a>
                </>
              )}
            </span>
          )}
          {otras.map((p) => (
            <span key={p.usuario_id}>
              <b>{primerNombre(p.nombre)}</b>:{' '}
              {p.listo_at
                ? `lista ${horaLocal(p.listo_at)}`
                : p.notas.length
                  ? `${p.notas.length} ${p.notas.length === 1 ? 'nota' : 'notas'}`
                  : `${p.cuentas} ${p.cuentas === 1 ? 'cuenta' : 'cuentas'}, ${p.tareas_hoy} ${p.tareas_hoy === 1 ? 'tarea' : 'tareas'}, todavía no`}
            </span>
          ))}
        </div>
      )}
      {notasDeOtras.length > 0 && (
        <ul className="text-xs text-gray-600 list-disc pl-4">
          {notasDeOtras.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      {narrativa !== null && (
        <div className="card p-3 space-y-2">
          <div className="flex justify-between items-center text-xs text-gray-500">
            <span>
              Borrador de {narrativaTipo ?? 'la IA'} · edítalo antes de publicar
              {narrativaTipo !== tipo ? ` · no se usará en ${ETIQUETA[tipo].la}` : ''}
            </span>
            <button
              className="link-danger"
              onClick={() => {
                setNarrativa(null);
                setNarrativaTipo(null);
              }}
            >
              Descartar
            </button>
          </div>
          <textarea className="input font-sans text-sm" rows={6} value={narrativa} onChange={(e) => setNarrativa(e.target.value)} />
        </div>
      )}
      {busy === 'ia' && !msg && (
        <div className="rounded-md border border-blue-200 bg-blue-50 text-blue-900 px-3 py-2 text-sm flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
          La IA está redactando con las señales del día…
        </div>
      )}
      {msg && (
        <div
          className={`rounded-md border px-3 py-2 text-sm flex items-center justify-between gap-3 ${msg.tipo === 'ok' ? 'border-green-200 bg-green-50 text-green-900' : msg.tipo === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-violet-200 bg-violet-50 text-violet-900'}`}
        >
          <span>{msg.texto}</span>
          <span className="flex items-center gap-2 shrink-0">
            {msg.url && (
              <a className="btn-primary text-xs py-1" href={hrefExterno(msg.url)} target="_blank" rel="noreferrer">
                Ver en Basecamp ↗
              </a>
            )}
            <button className="btn-ghost text-xs py-1" onClick={() => setMsg(null)} aria-label="Cerrar">
              ×
            </button>
          </span>
        </div>
      )}

      {vista && (
        <div
          className="fixed inset-0 bg-black/40 flex items-stretch justify-center p-2 sm:p-6 z-50"
          onClick={() => busy !== 'enviar' && setVista(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={vista.modo === 'agregar' ? `Agregar a ${ETIQUETA[tipo].la}` : `Publicar ${tipo}`}
            className="bg-white rounded-lg shadow-xl w-full max-w-3xl flex flex-col min-h-0"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-gray-200">
              <div className="font-semibold">
                {vista.modo === 'agregar' ? `Agregar a ${ETIQUETA[tipo].la} de ${mesaNombre}` : vista.asunto}
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                {vista.modo === 'agregar'
                  ? `Ya se publicó a las ${vista.hora_publicada ?? ''}. Lo nuevo va como comentario en el mismo mensaje y avisa a quienes lo siguen.`
                  : vista.avisados !== null
                    ? `Sale a tu nombre y avisa a las ${vista.avisados} personas del proyecto en Basecamp.`
                    : 'Sale a tu nombre y avisa a las personas del proyecto en Basecamp.'}
              </p>
            </div>
            {vista.avisos.length > 0 && (
              <ul className="px-5 py-3 bg-amber-50 border-b border-amber-200 text-sm text-amber-900 list-disc pl-9 space-y-0.5">
                {vista.avisos.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}
            {vista.nada_nuevo ? (
              <p className="p-5 text-sm text-gray-600 flex-1">No hay nada nuevo que agregar: todo ya salió en el mensaje.</p>
            ) : (
              // Sin permisos: el HTML se muestra aislado de la página, sin scripts ni acceso a la sesión.
              <iframe
                title="Vista previa del mensaje"
                sandbox=""
                className="flex-1 min-h-[16rem] w-full"
                srcDoc={`<!doctype html><meta charset="utf-8"><body style="font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1f2937;margin:16px 20px">${vista.html}</body>`}
              />
            )}
            <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
              <button className="btn-ghost" disabled={busy === 'enviar'} onClick={() => setVista(null)}>
                Volver
              </button>
              {!vista.nada_nuevo && (
                <button className={tipo === 'apertura' ? 'btn-success' : 'btn-danger'} disabled={busy === 'enviar'} onClick={enviar}>
                  {busy === 'enviar' ? 'Enviando a Basecamp…' : vista.modo === 'agregar' ? 'Agregar al mensaje' : `Publicar ${tipo}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
