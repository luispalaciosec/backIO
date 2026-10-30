import type { Cliente } from '@backio/shared';
import { apiServer } from '@/lib/api.server';
import { meServer } from '@/lib/me.server';
import { PreguntasEntrega } from './PreguntasEntrega';

export const dynamic = 'force-dynamic';

/** Mi día (docs/22): lo de cada persona para hoy. Por ahora, «¿ya se entregó?». */
export default async function MiDiaPage() {
  const [me, { items: clientes }] = await Promise.all([meServer(), apiServer<{ items: Cliente[] }>('/clientes')]);
  return (
    <div className="max-w-4xl space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Mi día{me.nombre ? ` · ${me.nombre.split(' ')[0]}` : ''}</h1>
        <p className="text-sm text-gray-500">Lo que necesita una respuesta tuya hoy.</p>
      </header>
      <PreguntasEntrega clientes={Object.fromEntries(clientes.map((c) => [c.id, c.nombre]))} />
    </div>
  );
}
