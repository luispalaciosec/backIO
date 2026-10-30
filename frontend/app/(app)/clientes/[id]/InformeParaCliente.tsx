'use client';
import { useEffect, useState } from 'react';
import type { InformeCliente } from '@backio/shared';
import { hoyLocal, sumarDias } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { fecha } from '@/lib/format';
import { useIA } from '@/lib/useIA';

/** Mes por defecto del informe mensual: en la primera semana del mes, el anterior; si no, el que corre. */
function mesPorDefecto(hoy: string): string {
  return Number(hoy.slice(8, 10)) <= 7 ? sumarDias(`${hoy.slice(0, 7)}-01`, -1).slice(0, 7) : hoy.slice(0, 7);
}

const escapar = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Abre el informe en una ventana para imprimir o guardar como PDF. */
function imprimir(asunto: string, cuerpo: string) {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapar(asunto)}</title>` +
      '<style>body{font:15px/1.6 system-ui,sans-serif;color:#1f2937;max-width:680px;margin:48px auto;padding:0 24px}' +
      'h1{font-size:18px;margin:0 0 24px}pre{white-space:pre-wrap;font:inherit;margin:0}</style></head>' +
      `<body><h1>${escapar(asunto)}</h1><pre>${escapar(cuerpo)}</pre></body></html>`,
  );
  w.document.close();
  w.focus();
  w.print();
}

/**
 * Informe para el cliente (docs/21): la IA lo redacta solo con lo que el cliente puede ver; la ejecutiva lo revisa, lo
 * edita y lo envía desde su correo. No se publica en el portal.
 */
export function InformeParaCliente({ clienteId }: { clienteId: string }) {
  const ia = useIA();
  const hoy = hoyLocal();
  const [periodo, setPeriodo] = useState<'semanal' | 'mensual'>('semanal');
  const [mes, setMes] = useState(mesPorDefecto(hoy));
  const [historial, setHistorial] = useState<InformeCliente[] | null>(null);
  const [actual, setActual] = useState<InformeCliente | null>(null);
  const [asunto, setAsunto] = useState('');
  const [cuerpo, setCuerpo] = useState('');
  const [busy, setBusy] = useState<'generar' | 'guardar' | null>(null);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  function abrir(x: InformeCliente | null) {
    setActual(x);
    setAsunto(x?.asunto ?? '');
    setCuerpo(x?.cuerpo ?? '');
  }

  useEffect(() => {
    api<{ items: InformeCliente[] }>(`/clientes/${clienteId}/informes`)
      .then((r) => {
        setHistorial(r.items);
        abrir(r.items[0] ?? null);
      })
      .catch(() => setHistorial([]));
  }, [clienteId]);

  if (!ia) return null;
  const cambiado = !!actual && (asunto !== actual.asunto || cuerpo !== actual.cuerpo);

  async function generar() {
    if (cambiado && !window.confirm('Tienes cambios sin guardar en el informe abierto. ¿Generar uno nuevo igual?')) return;
    setBusy('generar');
    setMsg(null);
    try {
      const x = await api<InformeCliente>(`/clientes/${clienteId}/informes`, {
        method: 'POST',
        json: periodo === 'mensual' ? { periodo, mes } : { periodo },
      });
      setHistorial((h) => [x, ...(h ?? [])]);
      abrir(x);
      setMsg({ tipo: 'ok', texto: 'Informe listo. Revísalo antes de enviarlo.' });
    } catch (e) {
      setMsg({ tipo: 'error', texto: e instanceof ApiError ? e.message : 'No se pudo generar el informe' });
    }
    setBusy(null);
  }

  async function guardar() {
    if (!actual) return;
    setBusy('guardar');
    setMsg(null);
    try {
      const x = await api<InformeCliente>(`/clientes/${clienteId}/informes/${actual.id}`, { method: 'PATCH', json: { asunto, cuerpo } });
      setHistorial((h) => (h ?? []).map((y) => (y.id === x.id ? x : y)));
      abrir(x);
      setMsg({ tipo: 'ok', texto: 'Cambios guardados.' });
    } catch (e) {
      setMsg({ tipo: 'error', texto: e instanceof ApiError ? e.message : 'No se pudieron guardar los cambios' });
    }
    setBusy(null);
  }

  const pendientes = (cuerpo.match(/\[completa:[^\]]*\]/g) ?? []).length;

  async function copiar() {
    if (pendientes && !window.confirm(`Quedan ${pendientes} «[completa: …]» por llenar. ¿Copiar igual?`)) return;
    try {
      await navigator.clipboard.writeText(`${asunto}\n\n${cuerpo}`);
      setMsg({ tipo: 'ok', texto: 'Copiado: pégalo en tu correo.' });
    } catch {
      setMsg({ tipo: 'error', texto: 'El navegador no dejó copiar. Selecciona el texto y cópialo a mano.' });
    }
  }

  return (
    <section className="card">
      <div className="px-4 py-3 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold">Informe para el cliente</div>
          <p className="text-xs text-gray-500 mt-0.5">
            La IA arma el borrador con cuántas entregas hubo por proyecto, cuántas vienen y cuántas esperan al cliente, y los nombres solo
            de lo que el cliente ve en el portal. Nunca recibe títulos internos. Completa lo que diga «[completa: …]», revísalo y envíalo
            desde tu correo. No se publica en el portal.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">
            <span className="label">Periodo</span>
            <select className="input" value={periodo} onChange={(e) => setPeriodo(e.target.value as 'semanal' | 'mensual')}>
              <option value="semanal">Últimos 7 días</option>
              <option value="mensual">Un mes</option>
            </select>
          </label>
          {periodo === 'mensual' && (
            <label className="text-xs">
              <span className="label">Mes</span>
              <input type="month" className="input" value={mes} max={hoy.slice(0, 7)} onChange={(e) => setMes(e.target.value)} />
            </label>
          )}
          <button className="btn-primary text-xs" disabled={!!busy || (periodo === 'mensual' && !mes)} onClick={generar}>
            {busy === 'generar' ? 'Redactando…' : '✨ Generar informe'}
          </button>
        </div>
      </div>
      {msg && (
        <p className={`px-4 pt-3 text-sm ${msg.tipo === 'ok' ? 'text-green-700' : 'text-red-600'}`} role="status">
          {msg.texto}
        </p>
      )}
      {historial === null && <p className="p-4 text-sm text-gray-500">Cargando…</p>}
      {historial?.length === 0 && !actual && <p className="p-4 text-sm text-gray-500">Todavía no hay informes para este cliente.</p>}
      {actual && (
        <div className="p-4 grid gap-4 lg:grid-cols-[1fr_220px]">
          <div className="space-y-2 min-w-0">
            <div className="text-xs text-gray-500">
              {actual.periodo === 'semanal' ? 'Semanal' : 'Mensual'} · del {fecha(actual.desde)} al {fecha(actual.hasta)}
              {actual.editado_at ? ' · editado' : ''}
            </div>
            <label className="block text-xs">
              <span className="label">Asunto</span>
              <input className="input w-full" value={asunto} onChange={(e) => setAsunto(e.target.value)} />
            </label>
            <label className="block text-xs">
              <span className="label">Cuerpo</span>
              <textarea
                className="input w-full font-normal leading-relaxed"
                rows={16}
                value={cuerpo}
                onChange={(e) => setCuerpo(e.target.value)}
              />
            </label>
            {pendientes > 0 && (
              <p className="text-xs text-amber-700">
                Quedan {pendientes} «[completa: …]» por llenar: escribe qué se entregó o qué viene antes de enviarlo.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary text-xs" disabled={!cambiado || !!busy || !asunto.trim() || !cuerpo.trim()} onClick={guardar}>
                {busy === 'guardar' ? 'Guardando…' : 'Guardar cambios'}
              </button>
              <button className="btn-secondary text-xs" onClick={copiar}>
                Copiar para el correo
              </button>
              <button className="btn-secondary text-xs" onClick={() => imprimir(asunto, cuerpo)}>
                Imprimir o guardar PDF
              </button>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Anteriores</div>
            <ul className="text-sm divide-y divide-gray-100">
              {(historial ?? []).map((x) => (
                <li key={x.id}>
                  <button
                    className={`w-full text-left py-1.5 hover:underline ${x.id === actual.id ? 'font-semibold' : ''}`}
                    onClick={() => {
                      if (cambiado && !window.confirm('Tienes cambios sin guardar. ¿Abrir otro informe igual?')) return;
                      abrir(x);
                    }}
                  >
                    {x.periodo === 'semanal' ? 'Semanal' : 'Mensual'} · {fecha(x.hasta)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
