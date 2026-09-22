import 'dotenv/config';
import { BasecampClient } from '../src/lib/basecamp/client';
import { serviceClient } from '../src/lib/db/client';
const T = '00000000-0000-4000-8000-000000000001';
async function main() {
  const db = serviceClient(); const bc = await BasecampClient.forTenant(T);
  const { data: c } = await db.from('clientes').select('id, basecamp_project_id').eq('nombre', 'Acme EC S.A.S').single();
  const P = (c as { basecamp_project_id: number }).basecamp_project_id;
  const { data: us } = await db.from('usuarios').select('id, basecamp_user_id').not('basecamp_user_id', 'is', null);
  const bcUser = new Map(((us ?? []) as { id: string; basecamp_user_id: number }[]).map((u) => [u.id, u.basecamp_user_id]));
  for (const [titulo, modo] of [['Brief interno', 'updateTodo'], ['Copies del mes', 'raw']] as const) {
    const { data } = await db.from('requerimientos').select('basecamp_todo_id, owner_agencia').eq('cliente_id', (c as { id: string }).id).eq('titulo_interno', titulo).limit(1).single();
    const r = data as { basecamp_todo_id: number; owner_agencia: string[] };
    const ids = r.owner_agencia.map((u) => bcUser.get(u)).filter((x): x is number => !!x);
    if (modo === 'updateTodo') await bc.updateTodo(P, r.basecamp_todo_id, { assignee_ids: ids });
    else { const v = await bc.request<{ content: string; due_on: string | null }>('GET', `/buckets/${P}/todos/${r.basecamp_todo_id}.json`); await bc.request('PUT', `/buckets/${P}/todos/${r.basecamp_todo_id}.json`, { content: v.content, due_on: v.due_on, assignee_ids: ids }); }
    const d = await bc.request<{ assignees?: { name: string }[]; updated_at: string }>('GET', `/buckets/${P}/todos/${r.basecamp_todo_id}.json`);
    console.log(modo, titulo, '→ ids', ids, '→ ahora', (d.assignees ?? []).map((a) => a.name), d.updated_at);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
