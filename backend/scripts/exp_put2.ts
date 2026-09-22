import 'dotenv/config';
import { BasecampClient } from '../src/lib/basecamp/client';
import { serviceClient } from '../src/lib/db/client';
const T = '00000000-0000-4000-8000-000000000001'; const P = 45126503; const C = '96a17c9d-b8b2-4dd1-83f3-1cdd7419461d';
async function main() {
  const db = serviceClient(); const bc = await BasecampClient.forTenant(T);
  const { data: us } = await db.from('usuarios').select('id, basecamp_user_id').not('basecamp_user_id', 'is', null);
  const bcUser = new Map(((us ?? []) as { id: string; basecamp_user_id: number }[]).map((u) => [u.id, u.basecamp_user_id]));
  for (const titulo of ['Guiones reels octubre - Banco Amazonas', 'Briefing Pasaportes']) {
    const { data } = await db.from('requerimientos').select('basecamp_todo_id, owner_agencia, fecha_entrega').eq('cliente_id', C).eq('titulo_interno', titulo).is('deleted_at', null).limit(1).single();
    const r = data as { basecamp_todo_id: number; owner_agencia: string[]; fecha_entrega: string | null };
    const ids = r.owner_agencia.map((u) => bcUser.get(u)).filter((x): x is number => !!x);
    await bc.updateTodo(P, r.basecamp_todo_id, { assignee_ids: ids });
    const d = await bc.request<{ assignees?: { name: string }[]; due_on: string | null; updated_at: string }>('GET', `/buckets/${P}/todos/${r.basecamp_todo_id}.json`);
    console.log(titulo, '→', (d.assignees ?? []).map((a) => a.name), 'due', d.due_on, 'backio', r.fecha_entrega, d.updated_at.slice(11, 19));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
