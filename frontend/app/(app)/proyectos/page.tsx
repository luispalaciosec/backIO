import Link from 'next/link';
import type { Proyecto } from '@backio/shared';
import { apiServer } from '@/lib/api.server';
import { AvanceBar } from '@/components/ui/AvanceBar';
import { EstadoChip } from '@/components/ui/EstadoChip';
import { fecha } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function ProyectosPage() {
  const { items } = await apiServer<{ items: (Proyecto & { avance: number; cliente_nombre: string })[] }>('/proyectos');
  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Proyectos</h1>
          <p className="text-sm text-gray-500">{items.length} proyectos · avance ponderado interno</p>
        </div>
        <Link href="/proyectos/nuevo" className="btn-primary">+ Nuevo proyecto</Link>
      </header>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.length === 0 && <div className="card p-6 text-gray-500">Aún no hay proyectos. Crea el primero con el Builder.</div>}
        {items.map((p) => (
          <Link key={p.id} href={`/proyectos/${p.id}`} className="card p-4 hover:border-brand transition space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-xs text-gray-500">{p.cliente_nombre}</div>
                <div className="font-semibold">{p.nombre}</div>
              </div>
              <EstadoChip estado={p.estado} />
            </div>
            <AvanceBar valor={p.avance} alto="h-2" />
            <div className="flex justify-between text-xs text-gray-500">
              <span>Entrega {fecha(p.fecha_entrega)}</span>
              <span>{p.portal_activo ? 'Portal activo' : 'Portal inactivo'}{p.sync_estado === 'incompleto' && ' · ⚠ sync Basecamp'}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
