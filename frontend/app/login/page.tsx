'use client';
import Link from 'next/link';
import { Suspense, useCallback, useState, type FormEvent } from 'react';
import { Turnstile, SITE_KEY_TURNSTILE } from '@/components/Turnstile';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { rutaInterna } from '@/lib/url';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Captcha (si está configurado): token de un solo uso; `intento` vuelve a montar el widget tras un fallo.
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  const recibirToken = useCallback((t: string | null) => setCaptcha(t), []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email, password, ...(captcha ? { options: { captchaToken: captcha } } : {}) });
    setLoading(false);
    if (error) {
      setCaptcha(null); setIntento((n) => n + 1);
      return setError(/captcha/i.test(error.message) ? 'Completa la verificación y vuelve a intentar.' : 'Credenciales inválidas');
    }
    // Solo rutas internas: un `next` externo convertía el login en un redirector abierto (phishing).
    // Se resuelve como lo haría el navegador; la regex anterior dejaba pasar «/\t/evil.com» (auditoría run-1).
    router.replace(rutaInterna(params.get('next')));
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card w-full max-w-sm p-8 space-y-5">
      <div>
        <div className="text-2xl font-bold tracking-tight">BackIO</div>
        <div className="text-sm text-gray-500">Geeks Ecuador · acceso interno</div>
      </div>
      <div>
        <label className="label" htmlFor="email">Correo</label>
        <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div>
        <label className="label" htmlFor="password">Contraseña</label>
        <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <Turnstile key={intento} onToken={recibirToken} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button className="btn-primary w-full" disabled={loading || (!!SITE_KEY_TURNSTILE && !captcha)}>{loading ? 'Entrando…' : 'Entrar'}</button>
      <Link href="/auth/recuperar" className="block text-center text-sm link-action">¿Olvidaste tu contraseña?</Link>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
