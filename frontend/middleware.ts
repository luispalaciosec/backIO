import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

const PUBLICAS = [/^\/login/, /^\/auth\//, /^\/oauth\//, /^\/p\//, /^\/robots\.txt/, /^\/_next\//, /^\/favicon/, /\.(svg|png|jpg|jpeg|ico|webp|txt|xml|webmanifest)$/];

/**
 * CSP con nonce (auditoría 10/10, M2). La sesión de Supabase es legible desde JS, así que la CSP es la defensa
 * principal frente a un XSS: solo se ejecutan los scripts de BackIO con el nonce de esta respuesta (y los que esos
 * cargan, 'strict-dynamic'), y solo se conecta al backend y a Supabase. Turnstile (captcha) desde Cloudflare.
 */
function politicaCsp(nonce: string): string {
  const prod = process.env.NODE_ENV === 'production';
  const backend = process.env.NEXT_PUBLIC_BACKEND_URL ?? '';
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const turnstile = 'https://challenges.cloudflare.com';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${turnstile}${prod ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${backend} ${supabase} ${supabase.replace(/^https:/, 'wss:')}${prod ? '' : ' ws: http://localhost:*'}`,
    `frame-src ${turnstile}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(prod ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

export async function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = politicaCsp(nonce);
  // Next lee el nonce de la cabecera CSP de la petición y lo pone en sus propios scripts.
  const seguir = () => {
    const h = new Headers(req.headers);
    h.set('x-nonce', nonce);
    h.set('content-security-policy', csp);
    return NextResponse.next({ request: { headers: h } });
  };
  const conCsp = (r: NextResponse) => { r.headers.set('Content-Security-Policy', csp); return r; };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return new NextResponse(
      'BackIO: faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en las variables de entorno del despliegue. Cárgalas y redeploya.',
      { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }
  let res = seguir();
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = seguir();
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  const esPublica = PUBLICAS.some((re) => re.test(req.nextUrl.pathname));
  if (!data.user && !esPublica) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', req.nextUrl.pathname);
    return conCsp(NextResponse.redirect(url));
  }
  if (data.user && req.nextUrl.pathname === '/login') {
    return conCsp(NextResponse.redirect(new URL('/backlog', req.url)));
  }
  return conCsp(res);
}

export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'] };
