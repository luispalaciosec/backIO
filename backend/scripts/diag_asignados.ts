import 'dotenv/config';
import { BasecampClient } from '../src/lib/basecamp/client';
import { serviceClient } from '../src/lib/db/client';
const T = '00000000-0000-4000-8000-000000000001';
async function main() {
  const db = serviceClient(); const bc = await BasecampClient.forTenant(T);
  const { data: cls } = await db.from('clientes').select('id, nombre, basecamp_project_id').eq('tenant_id', T).eq('activo', true).not('basecamp_project_id', 'is', null);
  for (const c of (cls ?? []) as { id: string; nombre: string; basecamp_project_id: number }[]) {
    const { data: reqs } = await db.from('requerimientos').select('titulo_interno, owner_agencia, basecamp_todo_id, fecha_entrega, updated_at').eq('cliente_id', c.id).is('deleted_at', null).not('basecamp_todo_id', 'is', null).not('estado_operativo', 'in', '("completado","cancelado")');
    for (const r of (reqs ?? []) as { titulo_interno: string; owner_agencia: string[]; basecamp_todo_id: number; fecha_entrega: string | null; updated_at: string }[]) {
      if (!r.owner_agencia.length) continue;
      const v = await bc.request<{ assignees?: { id: number }[]; due_on: string | null; updated_at: string }>('GET', `/buckets/${c.basecamp_project_id}/todos/${r.basecamp_todo_id}.json`);
      if ((v.assignees ?? []).length) continue;
      console.log(`${r.titulo_interno.slice(0, 40).padEnd(40)} bc_due=${v.due_on} backio=${r.fecha_entrega} ${v.due_on === r.fecha_entrega ? 'IGUAL' : 'DIFIERE'} bc_updated=${v.updated_at.slice(0, 16)}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
