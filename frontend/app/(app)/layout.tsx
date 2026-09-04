import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { SignOutButton } from '@/components/SignOutButton';

const NAV = [
  { href: '/backlog', label: 'Backlog' },
  { href: '/proyectos', label: 'Proyectos' },
  { href: '/daily', label: 'Daily' },
  { href: '/weekly', label: 'Weekly' },
];
const ADMIN = [
  { href: '/admin/clientes', label: 'Clientes' },
  { href: '/admin/usuarios', label: 'Usuarios' },
  { href: '/admin/integraciones', label: 'Integraciones' },
  { href: '/admin/api-keys', label: 'API keys' },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { data } = await supabaseServer().auth.getUser();
  if (!data.user) redirect('/login');
  return (
    <div className="min-h-screen flex">
      <aside className="w-56 shrink-0 border-r border-gray-200 bg-white flex flex-col">
        <div className="px-5 py-4 border-b border-gray-200">
          <Link href="/backlog" className="text-lg font-bold tracking-tight">BackIO</Link>
          <div className="text-xs text-gray-500">Geeks Ecuador</div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="block rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">
              {n.label}
            </Link>
          ))}
          <div className="pt-3 mt-3 border-t border-gray-100 text-[10px] uppercase tracking-wide text-gray-400 px-3">Admin</div>
          {ADMIN.map((n) => (
            <Link key={n.href} href={n.href} className="block rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">
              {n.label}
            </Link>
          ))}
          <Link href="/proyectos/nuevo" className="btn-primary w-full mt-4">+ Nuevo proyecto</Link>
          <Link href="/proyectos/importar" className="btn-ghost w-full text-xs">Importar CSV</Link>
        </nav>
        <div className="p-3 border-t border-gray-200 text-xs text-gray-500 flex items-center justify-between gap-2">
          <span className="truncate">{data.user.email}</span>
          <SignOutButton />
        </div>
      </aside>
      <main className="flex-1 min-w-0 p-6">{children}</main>
    </div>
  );
}
