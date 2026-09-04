'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

export default function EstablecerClavePage() {
  const router = useRouter();
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'invalido' | 'ok'>('cargando');
  const [clave, setClave] = useState('');
  const [clave2, setClave2] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabaseBrowser();
    // El enlace de invitación deja la sesión en el hash (#access_token) o como ?code= (PKCE).
    const code = new URLSearchParams(window.location.search).get('code');
    const listo = async () => {
      if (code) { const { error } = await sb.auth.exchangeCodeForSession(code); if (error) return setEstado('invalido'); }
      const { data } = await sb.auth.getSession();
      setEstado(data.session ? 'listo' : 'invalido');
    };
    const t = setTimeout(listo, 300);
    return () => clearTimeout(t);
  }, []);

  async function guardar(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (clave.length < 8) return setError('Mínimo 8 caracteres.');
    if (clave !== clave2) return setError('Las contraseñas no coinciden.');
    const { error } = await supabaseBrowser().auth.updateUser({ password: clave });
    if (error) return setError(error.message);
    setEstado('ok');
    setTimeout(() => { router.replace('/dashboard'); router.refresh(); }, 800);
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="card w-full max-w-sm p-8 space-y-4">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/backio-icon.svg" alt="" width={36} height={36} className="rounded-lg" />
          <div><div className="font-bold text-lg">BackIO</div><div className="text-xs text-gray-500">Geeks Ecuador</div></div>
        </div>
        {estado === 'cargando' && <p className="text-sm text-gray-500">Verificando enlace…</p>}
        {estado === 'invalido' && <p className="text-sm text-red-600">El enlace no es válido o venció. Pide a un administrador que reenvíe la invitación desde Admin → Usuarios.</p>}
        {estado === 'ok' && <p className="text-sm text-green-700">Contraseña guardada. Entrando…</p>}
        {estado === 'listo' && (
          <form onSubmit={guardar} className="space-y-3">
            <p className="text-sm text-gray-600">Define tu contraseña para entrar.</p>
            <input className="input" type="password" autoComplete="new-password" placeholder="Nueva contraseña" value={clave} onChange={(e) => setClave(e.target.value)} required />
            <input className="input" type="password" autoComplete="new-password" placeholder="Repetir contraseña" value={clave2} onChange={(e) => setClave2(e.target.value)} required />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button className="btn-primary w-full">Guardar y entrar</button>
          </form>
        )}
      </div>
    </main>
  );
}
