'use client';
import { useEffect, useState } from 'react';
import type { Cliente, Mesa } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';

export default function AdminClientesPage() {
  const [items, setItems] = useState<Cliente[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [mesasAlta, setMesasAlta] = useState<Mesa[]>([]);
  const [nuevo, setNuevo] = useState({ nombre: '', basecamp_project_id: '', mesa_id: '', grupo: '' });
  const [creando, setCreando] = useState(false);
  useEffect(() => { api<{ items: Mesa[] }>('/mesas').then((r) => setMesasAlta(r.items.filter((m) => m.activa))).catch(() => {}); }, []);
  const [diag, setDiag] = useState<Record<string, unknown> | null>(null);
  const cargar = () => api<{ items: Cliente[] }>('/clientes?todos=1').then((r) => setItems(r.items)).catch((e) => setError(e instanceof ApiError ? e.message : 'Error'));
  useEffect(() => { void cargar(); }, []);

  async function guardar(c: Cliente, form: FormData) {
    setError(null); setOk(null);
    const bc = String(form.get('basecamp_project_id') ?? '').trim();
    const pin = String(form.get('portal_pin') ?? '').trim();
    try {
      await api(`/clientes/${c.id}`, { method: 'PATCH', json: {
        basecamp_project_id: bc ? Number(bc) : null,
        color_primario: String(form.get('color_primario') || '#0073EA'),
        logo_url: String(form.get('logo_url') || '') || null,
        config: { ...(c.config ?? {}), portal_pin: pin || null },
      } });
      setOk(`${c.nombre} actualizado`);
      await cargar();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
  }

  return (
    <div className="max-w-5xl space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Clientes</h1>
        <p className="text-sm text-gray-500">Normalmente vienen de PrometIO con el mismo id. Aquí se configura lo que PrometIO no conoce (proyecto de Basecamp, mesa, branding del portal y PIN) y se dan de alta a mano los clientes que no pasan por PrometIO, como las ramas de una misma cuenta.</p>
      </header>
      {error && <Alert tipo="error">{error}</Alert>}
      {ok && <Alert tipo="ok">{ok}</Alert>}
      <form className="card p-4 grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_1fr_auto] items-end border-brand/30 bg-brand/5" onSubmit={async (e) => {
        e.preventDefault(); setCreando(true); setError(null); setOk(null);
        try {
          const c = await api<Cliente>('/clientes', { method: 'POST', json: { nombre: nuevo.nombre.trim(), basecamp_project_id: nuevo.basecamp_project_id ? Number(nuevo.basecamp_project_id) : null, mesa_id: nuevo.mesa_id || null, grupo: nuevo.grupo.trim() || null } });
          setOk(`Cliente "${c.nombre}" creado.${c.basecamp_project_id ? ' Ahora activa el webhook e importa sus listas desde su fila.' : ''}`);
          setNuevo({ nombre: '', basecamp_project_id: '', mesa_id: '', grupo: '' }); await cargar();
        } catch (err) { setError(err instanceof ApiError ? err.message : 'Error'); }
        setCreando(false);
      }}>
        <div><label className="label">Nuevo cliente (alta manual)</label><input className="input" required minLength={2} placeholder="AB-Inbev · OFFline ON" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} /></div>
        <div><label className="label">Basecamp project id</label><input className="input" inputMode="numeric" placeholder="48850050" value={nuevo.basecamp_project_id} onChange={(e) => setNuevo({ ...nuevo, basecamp_project_id: e.target.value.replace(/\D/g, '') })} /></div>
        <div><label className="label">Mesa</label><select className="input" value={nuevo.mesa_id} onChange={(e) => setNuevo({ ...nuevo, mesa_id: e.target.value })}><option value="">Sin mesa</option>{mesasAlta.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select></div>
        <div><label className="label">Grupo (cuenta madre)</label><input className="input" placeholder="AB-Inbev" value={nuevo.grupo} onChange={(e) => setNuevo({ ...nuevo, grupo: e.target.value })} /></div>
        <button className="btn-primary" disabled={creando || nuevo.nombre.trim().length < 2}>{creando ? 'Creando…' : '+ Crear cliente'}</button>
      </form>
      <div className="space-y-3">
        {items.map((c) => (
          <form key={c.id} className="card p-4 grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_0.7fr_0.6fr_auto] items-end" action={(fd) => guardar(c, fd)}>
            <div>
              <div className="font-semibold">{c.nombre} {!c.activo && <span className="text-xs text-gray-400">(inactivo)</span>}</div>
              <div className="text-xs text-gray-400 font-mono">{c.id}</div>
            </div>
            <div><label className="label">Basecamp project id</label><input name="basecamp_project_id" className="input" inputMode="numeric" defaultValue={c.basecamp_project_id ?? ''} placeholder="Ej. 12345678" /></div>
            <div><label className="label">Logo URL</label><input name="logo_url" className="input" defaultValue={c.logo_url ?? ''} /></div>
            <div><label className="label">Color</label><input name="color_primario" type="color" className="input h-9 p-1" defaultValue={c.color_primario ?? '#0073EA'} /></div>
            <div><label className="label">PIN portal</label><input name="portal_pin" className="input" maxLength={6} defaultValue={String((c.config as { portal_pin?: string })?.portal_pin ?? '')} placeholder="opcional" /></div>
            <div className="flex gap-1">
              <button className="btn-primary">Guardar</button>
              {c.basecamp_project_id && (
                <button type="button" className={`${(c.config as { basecamp_webhook_id?: number })?.basecamp_webhook_id ? 'btn-success' : 'btn-secondary'} text-xs`} title="Registrar webhook de BackIO en el proyecto Basecamp" onClick={async () => {
                  setError(null); setOk(null);
                  try { const r = await api<{ webhook_id: number }>(`/clientes/${c.id}/basecamp/webhook`, { method: 'POST' }); setOk(`Webhook ${r.webhook_id} registrado en Basecamp para ${c.nombre}`); await cargar(); }
                  catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
                }}>{(c.config as { basecamp_webhook_id?: number })?.basecamp_webhook_id ? '✓ Webhook activo' : 'Activar webhook'}</button>
              )}
              {c.basecamp_project_id && (
                <button type="button" className={`${c.basecamp_importado_at ? 'btn-ghost' : 'btn-primary'} text-xs`} title={c.basecamp_importado_at ? `Importado ${new Date(c.basecamp_importado_at).toLocaleString('es-EC')}. Volver a importar trae solo lo nuevo.` : 'Trae las listas y to-dos existentes del proyecto Basecamp (solo títulos, nunca comentarios)'} onClick={async () => {
                  if (!confirm(`Importar las listas de to-dos de "${c.nombre}" desde Basecamp. Solo entran títulos, fechas, asignados y estado; nunca descripciones ni comentarios. ¿Continuar?`)) return;
                  setError(null); setOk(null);
                  try { const r = await api<{ listas: number; proyectos_creados: number; requerimientos_creados: number; ya_enlazados: number; omitidos_completados_viejos: number; responsables_actualizados: number }>(`/clientes/${c.id}/basecamp/importar`, { method: 'POST' }); setOk(`${c.nombre}: ${r.listas} listas · ${r.proyectos_creados} proyectos nuevos · ${r.requerimientos_creados} to-dos importados · ${r.ya_enlazados} ya enlazados · ${r.responsables_actualizados} responsables completados · ${r.omitidos_completados_viejos} completados antiguos omitidos`); await cargar(); }
                  catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
                }}>{c.basecamp_importado_at ? 'Reimportar' : 'Importar Basecamp'}</button>
              )}
              {(c.config as { basecamp_webhook_id?: number })?.basecamp_webhook_id && (
                <button type="button" className="btn-ghost text-xs" title="Ver entregas recientes del webhook" onClick={async () => {
                  setError(null);
                  try { setDiag(await api<Record<string, unknown>>(`/clientes/${c.id}/basecamp/webhook`)); }
                  catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
                }}>Diag</button>
              )}
            </div>
          </form>
        ))}
        {items.length === 0 && <div className="card p-6 text-gray-500">Sin clientes. Llegan desde PrometIO por webhook.</div>}
      </div>
      {diag && <pre className="card p-3 text-xs overflow-auto">{JSON.stringify(diag, null, 2)}</pre>}
      <p className="text-xs text-gray-500">El id del proyecto en Basecamp es el número de la URL: <code>3.basecamp.com/&lt;cuenta&gt;/projects/<b>&lt;id&gt;</b></code>.</p>
    </div>
  );
}
