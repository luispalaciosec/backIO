'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Rol } from '@backio/shared';
import { SignOutButton } from '@/components/SignOutButton';

type Hoja = { href: string; label: string; icon: string };
type Grupo = { id: string; label: string; icon: string; items: Hoja[] };

/** Menú de dos niveles: grupos que se abren y cierran; el grupo de la página actual se abre solo. */
const GRUPOS: Grupo[] = [
  { id: 'operacion', label: 'Operación', icon: '☰', items: [
    { href: '/backlog', label: 'Backlog', icon: '☰' },
    { href: '/proyectos', label: 'Proyectos', icon: '▦' },
    { href: '/huerfanos', label: 'Entradas Basecamp', icon: '⇣' },
  ] },
  { id: 'rituales', label: 'Rituales', icon: '◔', items: [
    { href: '/daily', label: 'Daily', icon: '◔' },
    { href: '/weekly', label: 'Weekly', icon: '◷' },
  ] },
  { id: 'equipo', label: 'Equipo', icon: '⚇', items: [
    { href: '/personas', label: 'Personas', icon: '⚇' },
    { href: '/dia-a-dia', label: 'Día a día', icon: '◴' },
  ] },
  { id: 'informes', label: 'Informes', icon: '◈', items: [
    { href: '/informes', label: 'Informes mensuales', icon: '◈' },
    { href: '/informes/canal', label: 'Informe por canal', icon: '▥' },
    { href: '/informes/estatus', label: 'Estatus por cliente', icon: '📝' },
  ] },
];
const ADMIN_GRUPOS: Grupo[] = [
  { id: 'cuentas', label: 'Cuentas y equipo', icon: '◉', items: [
    { href: '/admin/clientes', label: 'Clientes', icon: '◉' },
    { href: '/admin/mesas', label: 'Mesas', icon: '▤' },
    { href: '/admin/usuarios', label: 'Usuarios', icon: '⚇' },
  ] },
  { id: 'catalogo', label: 'Catálogo', icon: '▥', items: [
    { href: '/admin/plantillas', label: 'Plantillas', icon: '▥' },
    { href: '/admin/tipos-pieza', label: 'Tipos de pieza', icon: '▣' },
    { href: '/admin/recurrencias', label: 'Recurrencias', icon: '↻' },
  ] },
  { id: 'sistema', label: 'Sistema', icon: '⇄', items: [
    { href: '/admin/integraciones', label: 'Integraciones', icon: '⇄' },
    { href: '/admin/api-keys', label: 'API keys', icon: '⚿' },
    { href: '/admin/servicios', label: 'Servicios', icon: '♡' },
    { href: '/admin/auditoria', label: 'Auditoría', icon: '≡' },
  ] },
];
const KEY_ABIERTOS = 'backio:sidebar:abiertos'; // preferencia de UI
const KEY = 'backio:sidebar:colapsado'; // preferencia de UI, no dato de negocio

export function Sidebar({ email, rol }: { email: string; rol: Rol | null }) {
  const esAdmin = rol === 'admin';
  const escribe = rol !== null && rol !== 'colaborador';
  const [colapsado, setColapsado] = useState(false);
  const pathname = usePathname();
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  useEffect(() => { try { setColapsado(localStorage.getItem(KEY) === '1'); const a = JSON.parse(localStorage.getItem(KEY_ABIERTOS) ?? '[]') as string[]; setAbiertos(new Set(a)); } catch { /* ignore */ } }, []);
  // El grupo de la página actual siempre queda abierto.
  const grupoActual = [...GRUPOS, ...ADMIN_GRUPOS].find((g) => g.items.some((i) => pathname === i.href || pathname.startsWith(`${i.href}/`)))?.id;
  const toggleGrupo = (id: string) => setAbiertos((s0) => { const n = new Set(s0); n.has(id) ? n.delete(id) : n.add(id); try { localStorage.setItem(KEY_ABIERTOS, JSON.stringify([...n])); } catch { /* ignore */ } return n; });
  const toggle = () => setColapsado((c) => { try { localStorage.setItem(KEY, c ? '0' : '1'); } catch { /* ignore */ } return !c; });

  const Item = ({ href, label, icon, sub = false }: { href: string; label: string; icon: string; sub?: boolean }) => {
    const activo = pathname === href || (href !== '/informes' && pathname.startsWith(`${href}/`)) || (href === '/informes' && pathname === '/informes');
    return (
      <Link href={href} title={label} className={`flex items-center gap-3 rounded-md py-1.5 text-sm ${activo ? 'bg-brand/10 text-brand font-medium' : 'text-gray-700 hover:bg-gray-100'} ${colapsado ? 'justify-center px-0' : sub ? 'pl-9 pr-3' : 'px-3'}`}>
        {(colapsado || !sub) && <span className="w-5 text-center text-base leading-none">{icon}</span>}
        {!colapsado && <span>{label}</span>}
      </Link>
    );
  };
  const GrupoNav = ({ g }: { g: Grupo }) => {
    const abierto = colapsado ? false : abiertos.has(g.id) || grupoActual === g.id;
    const activoDentro = grupoActual === g.id;
    if (colapsado) return <>{g.items.map((i) => <Item key={i.href} {...i} />)}</>;
    return (
      <div>
        <button type="button" onClick={() => toggleGrupo(g.id)} className={`w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${activoDentro ? 'text-brand' : 'text-gray-800 hover:bg-gray-100'}`}>
          <span className="w-5 text-center text-base leading-none">{g.icon}</span>
          <span className="flex-1 text-left">{g.label}</span>
          <span className={`text-xs text-gray-400 transition-transform ${abierto ? 'rotate-90' : ''}`}>▸</span>
        </button>
        {abierto && <div className="space-y-0.5 mt-0.5">{g.items.map((i) => <Item key={i.href} {...i} sub />)}</div>}
      </div>
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
        <Item href="/dashboard" label="Dashboard" icon="◧" />
        {GRUPOS.map((g) => <GrupoNav key={g.id} g={g} />)}
        {esAdmin && <div className={`pt-3 mt-3 border-t border-gray-100 text-[10px] uppercase tracking-wide text-gray-400 ${colapsado ? 'text-center' : 'px-3'}`}>{colapsado ? '•' : 'Admin'}</div>}
        {esAdmin && ADMIN_GRUPOS.map((g) => <GrupoNav key={g.id} g={g} />)}
        {escribe && <Link href="/proyectos/nuevo" title="Nuevo proyecto" className={`btn-primary w-full mt-4 ${colapsado ? 'px-0' : ''}`}>{colapsado ? '+' : '+ Nuevo proyecto'}</Link>}
        {escribe && !colapsado && <Link href="/proyectos/importar" className="btn-ghost w-full text-xs">Importar CSV</Link>}
      </nav>
      <div className={`p-2 border-t border-gray-200 text-xs text-gray-500 flex items-center gap-2 ${colapsado ? 'flex-col' : 'justify-between'}`}>
        {!colapsado && <span className="truncate flex-1" title={rol ? `Rol: ${rol}` : ''}>{email}{rol ? <span className="text-gray-400"> · {rol}</span> : null}</span>}
        <SignOutButton />
        <button onClick={toggle} className="btn-ghost px-2 py-1" title={colapsado ? 'Expandir panel' : 'Ocultar panel'} aria-label="Alternar panel">{colapsado ? '»' : '«'}</button>
      </div>
    </aside>
  );
}
