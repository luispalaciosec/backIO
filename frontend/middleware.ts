import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

const PUBLICAS = [/^\/login/, /^\/p\//, /^\/robots\.txt/, /^\/_next\//, /^\/favicon/];

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
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
    return NextResponse.redirect(url);
  }
  if (data.user && req.nextUrl.pathname === '/login') {
    return NextResponse.redirect(new URL('/backlog', req.url));
  }
  return res;
}

export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'] };
