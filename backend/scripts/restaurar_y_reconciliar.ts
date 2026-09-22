import 'dotenv/config';
import { BasecampClient } from '../src/lib/basecamp/client';
import { serviceClient } from '../src/lib/db/client';
import { reconcileTenant } from '../src/lib/basecamp/reconcile';
const T = '00000000-0000-4000-8000-000000000001'; const P = 45126503; const C = '96a17c9d-b8b2-4dd1-83f3-1cdd7419461d';
async function main() {
  const db = serviceClient(); const bc = await BasecampClient.forTenant(T);
  const { data } = await db.from('requerimientos').select('basecamp_todo_id').eq('cliente_id', C).eq('titulo_interno', 'DDays octubre').is('deleted_at', null).limit(1).single();
  const todo = (data as { basecamp_todo_id: number }).basecamp_todo_id;
  await bc.updateTodo(P, todo, { assignee_ids: [49384157, 52283040] });
  const v = await bc.request<{ assignees?: { name: string }[] }>('GET', `/buckets/${P}/todos/${todo}.json`);
  console.log('DDays octubre restaurado →', (v.assignees ?? []).map((a) => a.name));
  console.time('reconcile');
  const r = await reconcileTenant({ db, tenantId: T, usuarioId: null, origen: 'cron' });
  console.timeEnd('reconcile');
  console.log('reconcile', r);
}
main().catch((e) => { console.error('ERROR', e instanceof Error ? e.message : e); process.exit(1); });
