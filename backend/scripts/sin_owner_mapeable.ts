import 'dotenv/config';
import { serviceClient } from '../src/lib/db/client';
const T = '00000000-0000-4000-8000-000000000001';
async function main() {
  const db = serviceClient();
  const { data: us } = await db.from('usuarios').select('id, nombre, basecamp_user_id');
  const U = new Map(((us ?? []) as { id: string; nombre: string; basecamp_user_id: number | null }[]).map((u) => [u.id, u]));
  const { data: cls } = await db.from('clientes').select('id, nombre').eq('tenant_id', T).eq('activo', true);
  const C = new Map(((cls ?? []) as { id: string; nombre: string }[]).map((c) => [c.id, c.nombre]));
  const { data: reqs } = await db.from('requerimientos').select('titulo_interno, owner_agencia, cliente_id, basecamp_url').eq('tenant_id', T).is('deleted_at', null).not('basecamp_todo_id', 'is', null).not('estado_operativo', 'in', '("completado","cancelado")');
  for (const r of (reqs ?? []) as { titulo_interno: string; owner_agencia: string[]; cliente_id: string; basecamp_url: string | null }[]) {
    if (!r.owner_agencia.length) continue;
    const sin = r.owner_agencia.map((id) => U.get(id)).filter((u) => u && !u.basecamp_user_id).map((u) => u!.nombre);
    const con = r.owner_agencia.map((id) => U.get(id)).filter((u) => u && u.basecamp_user_id).length;
    if (sin.length && !con) console.log(`${(C.get(r.cliente_id) ?? '').slice(0, 24).padEnd(24)} "${r.titulo_interno.slice(0, 45)}" → responsable sin Basecamp: ${sin.join(', ')}`);
  }
}
main();
