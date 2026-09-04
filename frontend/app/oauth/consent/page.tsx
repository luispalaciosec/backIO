'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiRaw, ApiError } from '@/lib/api';
import { supabaseBrowser } from '@/lib/supabase/client';

const DESCRIPCION: Record<string, string> = {
  'read:backlog': 'Leer el backlog y los requerimientos',
  'read:proyectos': 'Leer proyectos, clientes y plantillas',
  'read:senales': 'Leer señales y acuerdos del weekly',
  'read:capacidad': 'Leer capacidad por persona',
  'write:requerimientos': 'Actualizar requerimientos (con confirmación previa)',
  'write:proyectos': 'Crear proyectos desde plantilla (con confirmación previa)',
  'write:actas': 'Generar y publicar Plan Operativo y Acta de Cierre',
};

function Consent() {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sesion, setSesion] = useState<boolean | null>(null);
  const cliente = params.get('client_name') ?? 'Cliente MCP';
  const scopes = (params.get('scope') ?? '').split(' ').filter(Boolean);
  const redirect = params.get('redirect_uri') ?? '';

  useEffect(() => {
    supabaseBrowser().auth.getSession().then(({ data }) => {
      if (!data.session) {
        const next = `/oauth/consent?${params.toString()}`;
        router.replace(`/login?next=${encodeURIComponent(next)}`);
      } else setSesion(true);
    });
  }, [params, router]);

  async function aprobar() {
    setBusy(true); setError(null);
    try {
      const r = await apiRaw<{ redirect: string }>('/oauth/approve', { method: 'POST', json: {
        client_id: params.get('client_id'), redirect_uri: redirect, code_challenge: params.get('code_challenge'), scope: params.get('scope') ?? undefined, state: params.get('state') ?? undefined,
      } });
      window.location.href = r.redirect;
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo autorizar'); setBusy(false); }
  }
  function denegar() {
    const u = new URL(redirect);
    u.searchParams.set('error', 'access_denied');
    if (params.get('state')) u.searchParams.set('state', params.get('state')!);
    window.location.href = u.toString();
  }

  if (sesion === null) return <div className="text-gray-500 text-center py-20">Verificando sesión…</div>;
  let host = redirect; try { host = new URL(redirect).host; } catch { /* ignore */ }
  return (
    <div className="card w-full max-w-md p-8 space-y-5">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/backio-icon.svg" alt="" width={40} height={40} className="rounded-lg" />
        <div><div className="font-bold text-lg">Autorizar acceso</div><div className="text-sm text-gray-500">a tu cuenta de BackIO</div></div>
      </div>
      <p className="text-sm"><span className="font-semibold">{cliente}</span> <span className="text-gray-500">({host})</span> solicita:</p>
      <ul className="text-sm space-y-1">
        {scopes.map((s) => <li key={s} className="flex gap-2"><span className="text-green-600">✓</span>{DESCRIPCION[s] ?? s}</li>)}
      </ul>
      <p className="text-xs text-gray-500">Actuará con tu usuario y tu rol. Las escrituras siempre requieren que confirmes un plan antes de ejecutarse. Puedes revocar el acceso desde Admin → Integraciones.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-secondary flex-1" onClick={denegar} disabled={busy}>Denegar</button>
        <button className="btn-primary flex-1" onClick={aprobar} disabled={busy}>{busy ? 'Autorizando…' : 'Autorizar'}</button>
      </div>
    </div>
  );
}

export default function Page() {
  return <main className="min-h-screen flex items-center justify-center p-6"><Suspense><Consent /></Suspense></main>;
}
