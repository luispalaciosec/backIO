import 'dotenv/config';
import { BasecampClient } from '../src/lib/basecamp/client';
import { serviceClient } from '../src/lib/db/client';
async function main() {
  const bc = await BasecampClient.forTenant('00000000-0000-4000-8000-000000000001');
  const db = serviceClient();
  const { data } = await db.from('requerimientos').select('basecamp_todo_id, cliente_id').eq('titulo_interno', 'Cronograma Octubre').not('basecamp_todo_id', 'is', null).limit(1).single();
  const r = data as { basecamp_todo_id: number; cliente_id: string };
  const { data: c } = await db.from('clientes').select('basecamp_project_id').eq('id', r.cliente_id).single();
  const v = await bc.request<{ content: string; due_on: string | null; assignees?: { name: string }[]; description?: string }>('GET', `/buckets/${(c as { basecamp_project_id: number }).basecamp_project_id}/todos/${r.basecamp_todo_id}.json`);
  console.log({ content: v.content, due_on: v.due_on, assignees: (v.assignees ?? []).map((a) => a.name), descripcion_len: (v.description ?? '').length });
}
main();
