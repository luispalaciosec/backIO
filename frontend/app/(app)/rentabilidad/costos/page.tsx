import Link from 'next/link';
import type { Cliente, Usuario } from '@backio/shared';
import { nombrePersona } from '@backio/shared';
import { apiServer } from '@/lib/api.server';
import { meServer } from '@/lib/me.server';
import { Costos } from './Costos';

export const dynamic = 'force-dynamic';

const ROL: Record<string, string> = {
  admin: 'Admin',
  gerencia: 'Gerencia',
  operaciones: 'Operaciones',
  ejecutiva: 'Ejecutiva',
  lider: 'Líder',
  colaborador: 'Colaborador',
};

/** Sueldos y fees (docs/21, migración 41): solo gerencia y admin. */
export default async function CostosPage() {
  const me = await meServer();
  if (me.rol !== 'admin' && me.rol !== 'gerencia')
    return <p className="text-sm text-gray-500">Los sueldos y fees son solo para gerencia y admin.</p>;
  const [{ items: usuarios }, { items: clientes }] = await Promise.all([
    apiServer<{ items: Usuario[] }>('/usuarios'),
    apiServer<{ items: (Cliente & { es_prueba?: boolean })[] }>('/clientes'),
  ]);
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Sueldos y fees</h1>
          <p className="text-sm text-gray-500">Solo los ven gerencia y admin. Con esto se calcula la rentabilidad de cada cliente.</p>
        </div>
        <Link className="btn-secondary text-xs" href="/rentabilidad">
          ← Rentabilidad
        </Link>
      </header>
      <Costos
        personas={usuarios
          .filter((u) => u.activo)
          .map((u) => ({ id: u.id, nombre: nombrePersona(u), detalle: ROL[u.rol] ?? u.rol }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre))}
        clientes={clientes
          // Cuentas reales: con mesa o ejecutiva (las empresas que solo son contactos del CRM no tienen fee).
          .filter((c) => c.activo && !c.es_prueba && (c.mesa_id || c.ejecutiva_id))
          .map((c) => ({ id: c.id, nombre: c.nombre }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre))}
      />
    </div>
  );
}
