'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';

interface ApiKey { id: string; nombre: string; prefijo: string; scopes: string[]; perfil: string | null; ultimo_uso_at: string | null; revocada_at: string | null; created_at: string }

export default function AdminApiKeysPage() {
  const [items, setItems] = useState<ApiKey[]>([]);
  const [perfiles, setPerfiles] = useState<Record<string, string[]>>({});
  const [nueva, setNueva] = useState<{ nombre: string; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ nombre: '', perfil: 'gerencial' });

  const cargar = () => api<{ items: ApiKey[]; perfiles: Record<string, string[]> }>('/admin/api-keys').then((r) => { setItems(r.items); setPerfiles(r.perfiles); }).catch((e) => setError(e instanceof ApiError ? e.message : 'Error'));
  useEffect(() => { void cargar(); }, []);

  async function crear(e: FormEvent) {
    e.preventDefault(); setError(null);
    try { const r = await api<{ key: string; nombre: string }>('/admin/api-keys', { method: 'POST', json: form }); setNueva({ nombre: r.nombre, key: r.key }); setForm({ nombre: '', perfil: 'gerencial' }); await cargar(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">API keys</h1>
        <p className="text-sm text-gray-500">Para agentes (Claude, ChatGPT, Gemini) y PrometIO. Se guardan hasheadas y se muestran una sola vez.</p>
      </header>
      {error && <Alert tipo="error">{error}</Alert>}
      {nueva && (
        <Alert tipo="warn">
          <div className="font-semibold">Key creada: {nueva.nombre}. Cópiala ahora, no se volverá a mostrar.</div>
          <code className="block mt-2 p-2 bg-white rounded border text-xs break-all select-all">{nueva.key}</code>
        </Alert>
      )}
      <form onSubmit={crear} className="card p-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-48"><label className="label">Nombre</label><input className="input" required placeholder="Claude de Luis" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></div>
        <div className="min-w-48"><label className="label">Perfil</label>
          <select className="input" value={form.perfil} onChange={(e) => setForm({ ...form, perfil: e.target.value })}>
            {Object.keys(perfiles).map((p) => <option key={p} value={p}>{p} · {perfiles[p]?.join(', ')}</option>)}
          </select>
        </div>
        <button className="btn-primary">Crear key</button>
      </form>
      <section className="card overflow-x-auto">
        <table className="w-full min-w-[700px]">
          <thead><tr><th className="th">Nombre</th><th className="th">Prefijo</th><th className="th">Scopes</th><th className="th">Último uso</th><th className="th">Estado</th></tr></thead>
          <tbody>
            {items.map((k) => (
              <tr key={k.id} className={k.revocada_at ? 'opacity-50' : ''}>
                <td className="td font-medium">{k.nombre}<div className="text-xs text-gray-400">{k.perfil}</div></td>
                <td className="td font-mono text-xs">{k.prefijo}…</td>
                <td className="td text-xs">{k.scopes.join(', ')}</td>
                <td className="td text-xs">{k.ultimo_uso_at ? new Date(k.ultimo_uso_at).toLocaleString('es-EC') : 'nunca'}</td>
                <td className="td">{k.revocada_at ? <span className="text-xs">revocada</span> : <button className="link-danger" onClick={async () => { if (confirm(`¿Revocar "${k.nombre}"?`)) { await api(`/admin/api-keys/${k.id}/revocar`, { method: 'POST' }); void cargar(); } }}>revocar</button>}</td>
              </tr>
            ))}
            {items.length === 0 && <tr><td className="td text-gray-400" colSpan={5}>Sin keys.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
