import 'dotenv/config';
import { BasecampClient } from '../src/lib/basecamp/client';
import { serviceClient } from '../src/lib/db/client';
const P = 48775530;
async function main() {
  const bc = await BasecampClient.forTenant('00000000-0000-4000-8000-000000000001');
  const db = serviceClient();
  const { data } = await db.from('requerimientos').select('basecamp_todo_id').eq('titulo_interno', 'Brief interno').not('basecamp_todo_id', 'is', null).limit(1).single();
  const todo = (data as { basecamp_todo_id: number }).basecamp_todo_id;
  const gente = await bc.requestAll<{ id: number; name: string }>(`/projects/${P}/people.json`);
  const persona = gente[0]!;
  const t = await bc.request<{ content: string }>('GET', `/buckets/${P}/todos/${todo}.json`);
  await bc.request('PUT', `/buckets/${P}/todos/${todo}.json`, { content: t.content, assignee_ids: [persona.id] });
  const a = await bc.request<{ assignees: { name: string }[]; due_on: string | null }>('GET', `/buckets/${P}/todos/${todo}.json`);
  console.log('tras asignar a', persona.name, '→', a.assignees.map((x) => x.name), 'due', a.due_on);
  let status = 'HTTP 200'; try { await bc.request('PUT', `/buckets/${P}/todos/${todo}.json`, { due_on: '2026-10-01' }); } catch (e) { status = (e instanceof Error ? e.message : String(e)).slice(0, 100); }
  const b = await bc.request<{ assignees: { name: string }[]; due_on: string | null }>('GET', `/buckets/${P}/todos/${todo}.json`);
  console.log('tras PUT {due_on} solo →', status, '| assignees', b.assignees.map((x) => x.name), 'due', b.due_on);
}
main().catch((e) => { console.error(e); process.exit(1); });
