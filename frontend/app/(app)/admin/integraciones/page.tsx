'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError, BACKEND } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';

interface Status { conectado: boolean; cuenta?: string | null; cuenta_id?: number | null; autorizado_por?: string | null; expira_at?: string; conectado_at?: string }

function Integraciones() {
  const params = useSearchParams();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(params.get('basecamp') === 'error' ? params.get('motivo') : null);
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(() => api<Status>('/basecamp/status').then(setStatus).catch((e) => setError(e instanceof ApiError ? e.message : 'Error')), []);
  useEffect(() => { void cargar(); }, [cargar]);

  async function conectar() {
    setBusy(true); setError(null);
    try {
      const { url } = await api<{ url: string }>('/basecamp/oauth/url');
      window.location.href = url;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo iniciar la conexión');
      setBusy(false);
    }
  }
  async function desconectar() {
    if (!confirm('¿Desconectar Basecamp? Los to-dos existentes no se tocan; dejarán de sincronizarse hasta reconectar.')) return;
    setBusy(true);
    await api('/basecamp/disconnect', { method: 'POST' });
    setBusy(false);
    void cargar();
  }

  return (
    <div className="max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Integraciones</h1>
        <p className="text-sm text-gray-500">Solo administradores. Las credenciales se guardan en la configuración del tenant.</p>
      </header>
      {params.get('basecamp') === 'ok' && <Alert tipo="ok">Basecamp conectado correctamente.</Alert>}
      {error && <Alert tipo="error">{error}</Alert>}

      <section className="card p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-semibold text-lg">Basecamp</div>
            <div className="text-sm text-gray-500">Ejecución de producción. BackIO solo lee <code>completed</code>, <code>due_on</code> y asignaciones. Nunca texto.</div>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status?.conectado ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
            {status ? (status.conectado ? 'Conectado' : 'Sin conectar') : '…'}
          </span>
        </div>
        {status?.conectado && (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-gray-500">Cuenta</dt><dd>{status.cuenta ?? '—'} {status.cuenta_id ? <span className="text-gray-400">({status.cuenta_id})</span> : null}</dd>
            <dt className="text-gray-500">Autorizado por</dt><dd>{status.autorizado_por ?? '—'}</dd>
            <dt className="text-gray-500">Conectado</dt><dd>{status.conectado_at ? new Date(status.conectado_at).toLocaleString('es-EC') : '—'}</dd>
            <dt className="text-gray-500">Token expira</dt><dd>{status.expira_at ? new Date(status.expira_at).toLocaleString('es-EC') : '—'} <span className="text-gray-400">(se renueva solo)</span></dd>
          </dl>
        )}
        <div className="flex gap-2">
          {status?.conectado
            ? <><button className="btn-secondary" disabled={busy} onClick={conectar}>Reautorizar</button><button className="btn-ghost" disabled={busy} onClick={desconectar}>Desconectar</button></>
            : <button className="btn-primary" disabled={busy || !status} onClick={conectar}>{busy ? 'Redirigiendo…' : 'Conectar Basecamp'}</button>}
        </div>
      </section>

      <section className="card p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-semibold text-lg">MCP Server</div>
            <div className="text-sm text-gray-500">Una sola capa para Claude, ChatGPT, Gemini y agentes futuros. Las escrituras exigen preview + confirmación.</div>
          </div>
          <span className="rounded-full px-3 py-1 text-xs font-semibold bg-green-100 text-green-800">Activo</span>
        </div>
        <dl className="text-sm grid grid-cols-[120px_1fr] gap-y-1">
          <dt className="text-gray-500">Endpoint</dt><dd><code className="text-xs bg-gray-50 px-1.5 py-0.5 rounded select-all">{BACKEND}/mcp</code></dd>
          <dt className="text-gray-500">Auth</dt><dd>API key (<code className="text-xs">Authorization: Bearer bk_live_…</code>) u OAuth desde el cliente MCP</dd>
          <dt className="text-gray-500">OpenAPI</dt><dd><a className="text-brand underline text-xs" href={`${BACKEND}/api/openapi.json`} target="_blank" rel="noreferrer">{BACKEND}/api/openapi.json</a> <span className="text-xs text-gray-400">(para Gemini y clientes REST)</span></dd>
        </dl>
        <div className="text-xs text-gray-600 space-y-1">
          <div><span className="font-semibold">Lectura:</span> list_backlog · get_project_status · get_weekly_signals · get_capacity · get_client_health · search_requirements · list_clients_and_templates</div>
          <div><span className="font-semibold">Escritura:</span> plan_project_from_template → confirm_plan · plan_requirement_update → confirm_plan · generate_weekly_plan · generate_closing_minutes · publish_document</div>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer text-brand">Conectar Claude Code</summary>
          <pre className="mt-2 bg-gray-900 text-gray-100 text-xs p-3 rounded overflow-x-auto">{`claude mcp add --transport http backio ${BACKEND}/mcp --header "Authorization: Bearer bk_live_TU_KEY"`}</pre>
          <p className="text-xs text-gray-500 mt-1">Crea la key en Admin → API keys. Con OAuth: agrega el conector con la URL del endpoint y autoriza con tu usuario de BackIO.</p>
        </details>
      </section>

      <section className="card p-5 space-y-2 opacity-70">
        <div className="font-semibold text-lg">PrometIO</div>
        <div className="text-sm text-gray-500">Webhooks entrantes en <code>/api/v1/webhooks/prometio</code> firmados con HMAC. Los clientes llegan por ahí con el mismo <code>id</code>.</div>
      </section>
    </div>
  );
}

export default function Page() {
  return <Suspense><Integraciones /></Suspense>;
}
