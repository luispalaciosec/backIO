import 'dotenv/config';
import { BasecampClient } from '../src/lib/basecamp/client';
import { serviceClient } from '../src/lib/db/client';
const T = '00000000-0000-4000-8000-000000000001'; const P = 45126503; const C = '96a17c9d-b8b2-4dd1-83f3-1cdd7419461d';
async function main() {
  const db = serviceClient(); const bc = await BasecampClient.forTenant(T);
  const { data } = await db.from('requerimientos').select('basecamp_todo_id, fecha_entrega').eq('cliente_id', C).eq('titulo_interno', 'DDays octubre').is('deleted_at', null).limit(1).single();
  const r = data as { basecamp_todo_id: number; fecha_entrega: string };
  const leer = async () => { const v = await bc.request<{ due_on: string | null; assignees?: { name: string }[]; updated_at: string }>('GET', `/buckets/${P}/todos/${r.basecamp_todo_id}.json`); return `due=${v.due_on} asignados=${(v.assignees ?? []).map((a) => a.name).join(',')} upd=${v.updated_at.slice(11, 19)}`; };
  console.log('antes          ', await leer());
  await bc.updateTodo(P, r.basecamp_todo_id, { due_on: r.fecha_entrega });
  console.log('tras updateTodo', await leer());
  const raw = await bc.request<{ due_on: string | null }>('PUT', `/buckets/${P}/todos/${r.basecamp_todo_id}.json`, { content: 'DDays octubre', due_on: r.fecha_entrega });
  console.log('respuesta PUT crudo due_on =', raw.due_on);
  console.log('tras PUT crudo  ', await leer());
}
main().catch((e) => { console.error(e); process.exit(1); });
