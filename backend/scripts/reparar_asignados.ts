import 'dotenv/config';
import { BasecampClient } from '../src/lib/basecamp/client';
import { serviceClient } from '../src/lib/db/client';
const T = '00000000-0000-4000-8000-000000000001';
const SOLO_VER = process.argv.includes('--ver');
async function main() {
  const db = serviceClient();
  const bc = await BasecampClient.forTenant(T);
  const { data: us } = await db.from('usuarios').select('id, basecamp_user_id').not('basecamp_user_id', 'is', null);
  const bcUser = new Map(((us ?? []) as { id: string; basecamp_user_id: number }[]).map((u) => [u.id, u.basecamp_user_id]));
  const { data: cls } = await db.from('clientes').select('id, nombre, basecamp_project_id').eq('tenant_id', T).eq('activo', true).not('basecamp_project_id', 'is', null);
  let revisadas = 0, reparadas = 0, sinDatos = 0;
  for (const c of (cls ?? []) as { id: string; nombre: string; basecamp_project_id: number }[]) {
    const { data: reqs } = await db.from('requerimientos').select('id, titulo_interno, owner_agencia, basecamp_todo_id').eq('cliente_id', c.id).is('deleted_at', null).not('basecamp_todo_id', 'is', null).not('estado_operativo', 'in', '("completado","cancelado")');
    for (const r of (reqs ?? []) as { id: string; titulo_interno: string; owner_agencia: string[]; basecamp_todo_id: number }[]) {
      const ids = r.owner_agencia.map((u) => bcUser.get(u)).filter((x): x is number => !!x);
      if (!ids.length) { sinDatos += 1; continue; }
      revisadas += 1;
      try {
        const vivo = await bc.request<{ assignees?: { id: number }[] }>('GET', `/buckets/${c.basecamp_project_id}/todos/${r.basecamp_todo_id}.json`);
        if ((vivo.assignees ?? []).length) continue;
        console.log(`${SOLO_VER ? '[ver]' : '[reparar]'} ${c.nombre.slice(0, 28)} · "${r.titulo_interno.slice(0, 50)}" → ${ids.join(',')}`);
        if (!SOLO_VER) { await bc.updateTodo(c.basecamp_project_id, r.basecamp_todo_id, { assignee_ids: ids }); reparadas += 1; }
      } catch (e) { console.error('  error', r.basecamp_todo_id, e instanceof Error ? e.message.slice(0, 80) : e); }
    }
  }
  console.log({ revisadas, reparadas, sin_owner_en_backio: sinDatos });
}
main().catch((e) => { console.error(e); process.exit(1); });
