import 'dotenv/config';
import { BasecampClient } from '../src/lib/basecamp/client';
import { serviceClient } from '../src/lib/db/client';
async function main() {
  const bc = await BasecampClient.forTenant('00000000-0000-4000-8000-000000000001');
  const db = serviceClient();
  // El to-do de Banco Amazonas "Cronograma Octubre" (cliente 96a17c9d…) que el script reparó.
  const { data } = await db.from('requerimientos').select('basecamp_todo_id, owner_agencia').eq('cliente_id', '96a17c9d-b8b2-4dd1-83f3-1cdd7419461d').eq('titulo_interno', 'Cronograma Octubre').not('basecamp_todo_id', 'is', null).limit(1).single();
  const r = data as { basecamp_todo_id: number; owner_agencia: string[] };
  const { data: us } = await db.from('usuarios').select('id, basecamp_user_id').in('id', r.owner_agencia);
  const ids = ((us ?? []) as { basecamp_user_id: number | null }[]).map((u) => u.basecamp_user_id).filter((x): x is number => !!x);
  const P = 45126503;
  const antes = await bc.request<{ assignees?: { id: number; name: string }[]; content: string; due_on: string | null }>('GET', `/buckets/${P}/todos/${r.basecamp_todo_id}.json`);
  console.log('antes', { todo: r.basecamp_todo_id, ids, assignees: (antes.assignees ?? []).map((a) => a.name) });
  const resp = await bc.request<Record<string, unknown>>('PUT', `/buckets/${P}/todos/${r.basecamp_todo_id}.json`, { content: antes.content, due_on: antes.due_on, assignee_ids: ids });
  console.log('respuesta PUT', { assignees: ((resp.assignees as { name: string }[]) ?? []).map((a) => a.name), due_on: resp.due_on });
  const despues = await bc.request<{ assignees?: { name: string }[] }>('GET', `/buckets/${P}/todos/${r.basecamp_todo_id}.json`);
  console.log('después', (despues.assignees ?? []).map((a) => a.name));
}
main().catch((e) => { console.error(e); process.exit(1); });
