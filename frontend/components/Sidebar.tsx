'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SignOutButton } from '@/components/SignOutButton';

const NAV = [
  { href: '/backlog', label: 'Backlog', icon: '☰' },
  { href: '/proyectos', label: 'Proyectos', icon: '▦' },
  { href: '/daily', label: 'Daily', icon: '◔' },
  { href: '/weekly', label: 'Weekly', icon: '◷' },
];
const ADMIN = [
  { href: '/admin/clientes', label: 'Clientes', icon: '◉' },
  { href: '/admin/usuarios', label: 'Usuarios', icon: '⚇' },
  { href: '/admin/integraciones', label: 'Integraciones', icon: '⇄' },
  { href: '/admin/api-keys', label: 'API keys', icon: '⚿' },
];
const KEY = 'backio:sidebar:colapsado'; // preferencia de UI, no dato de negocio

export function Sidebar({ email }: { email: string }) {
  const [colapsado, setColapsado] = useState(false);
  const pathname = usePathname();
  useEffect(() => { try { setColapsado(localStorage.getItem(KEY) === '1'); } catch { /* ignore */ } }, []);
  const toggle = () => setColapsado((c) => { try { localStorage.setItem(KEY, c ? '0' : '1'); } catch { /* ignore */ } return !c; });

  const Item = ({ href, label, icon }: { href: string; label: string; icon: string }) => {
    const activo = pathname === href || pathname.startsWith(`${href}/`);
    return (
      <Link href={href} title={label} className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${activo ? 'bg-brand/10 text-brand font-medium' : 'text-gray-700 hover:bg-gray-100'} ${colapsado ? 'justify-center px-0' : ''}`}>
        <span className="w-5 text-center text-base leading-none">{icon}</span>
        {!colapsado && <span>{label}</span>}
      </Link>
    );
  };

  return (
    <aside className={`${colapsado ? 'w-16' : 'w-60'} shrink-0 border-r border-gray-200 bg-white flex flex-col transition-[width] duration-200`}>
      <div className={`flex items-center gap-3 border-b border-gray-200 ${colapsado ? 'justify-center px-2 py-3' : 'px-4 py-3'}`}>
        <Link href="/backlog" className="flex items-center gap-3 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/backio-icon.svg" alt="BackIO" width={36} height={36} className="rounded-lg shrink-0" />
          {!colapsado && <div className="min-w-0"><div className="text-lg font-bold tracking-tight leading-tight">BackIO</div><div className="text-xs text-gray-500 truncate">Geeks Ecuador</div></div>}
        </Link>
      </div>
      <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
        {NAV.map((n) => <Item key={n.href} {...n} />)}
        <div className={`pt-3 mt-3 border-t border-gray-100 text-[10px] uppercase tracking-wide text-gray-400 ${colapsado ? 'text-center' : 'px-3'}`}>{colapsado ? '•' : 'Admin'}</div>
        {ADMIN.map((n) => <Item key={n.href} {...n} />)}
        <Link href="/proyectos/nuevo" title="Nuevo proyecto" className={`btn-primary w-full mt-4 ${colapsado ? 'px-0' : ''}`}>{colapsado ? '+' : '+ Nuevo proyecto'}</Link>
        {!colapsado && <Link href="/proyectos/importar" className="btn-ghost w-full text-xs">Importar CSV</Link>}
      </nav>
      <div className={`p-2 border-t border-gray-200 text-xs text-gray-500 flex items-center gap-2 ${colapsado ? 'flex-col' : 'justify-between'}`}>
        {!colapsado && <span className="truncate flex-1">{email}</span>}
        <SignOutButton />
        <button onClick={toggle} className="btn-ghost px-2 py-1" title={colapsado ? 'Expandir panel' : 'Ocultar panel'} aria-label="Alternar panel">{colapsado ? '»' : '«'}</button>
      </div>
    </aside>
  );
}
