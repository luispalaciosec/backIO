import type { Cliente } from '@backio/shared';
import { apiServer } from '@/lib/api.server';
import { meServer } from '@/lib/me.server';
import { PreguntasEntrega } from './PreguntasEntrega';
import { MiDiaVista } from './MiDiaVista';

export const dynamic = 'force-dynamic';

/** Mi día (docs/22): lo de cada persona para hoy, con «¿ya se entregó?» primero porque pide una respuesta. */
export default async function MiDiaPage() {
  const [me, { items: clientes }] = await Promise.all([meServer(), apiServer<{ items: Cliente[] }>('/clientes')]);
  const nombres = Object.fromEntries(clientes.map((c) => [c.id, c.nombre]));
  return (
    <div className="max-w-5xl space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Mi día{me.nombre ? ` · ${me.nombre.split(' ')[0]}` : ''}</h1>
        <p className="text-sm text-gray-500">Lo tuyo para hoy, empezando por lo que necesita una respuesta.</p>
      </header>
      <PreguntasEntrega clientes={nombres} />
      <MiDiaVista clientes={nombres} />
    </div>
  );
}
