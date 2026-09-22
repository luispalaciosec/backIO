import 'dotenv/config';
import { BasecampClient } from '../src/lib/basecamp/client';
import { serviceClient } from '../src/lib/db/client';
const T = '00000000-0000-4000-8000-000000000001'; const P = 45126503; const C = '96a17c9d-b8b2-4dd1-83f3-1cdd7419461d';
async function main() {
  const db = serviceClient(); const bc = await BasecampClient.forTenant(T);
  const { data } = await db.from('requerimientos').select('titulo_interno, basecamp_todo_id, fecha_entrega').eq('cliente_id', C).eq('fecha_entrega', '2026-09-25').is('deleted_at', null).not('basecamp_todo_id', 'is', null).not('estado_operativo', 'in', '("completado","cancelado")').limit(6);
  let iguales = 0;
  for (const r of (data ?? []) as { titulo_interno: string; basecamp_todo_id: number; fecha_entrega: string }[]) {
    const v = await bc.request<{ due_on: string | null; assignees?: { name: string }[] }>('GET', `/buckets/${P}/todos/${r.basecamp_todo_id}.json`);
    if (v.due_on === r.fecha_entrega) iguales += 1;
    console.log(`${r.titulo_interno.slice(0, 38).padEnd(38)} bc=${v.due_on} backio=${r.fecha_entrega} ${v.due_on === r.fecha_entrega ? '✓' : '✗'} asignados=${(v.assignees ?? []).map((a) => a.name).join(', ') || '—'}`);
  }
  console.log('coinciden', iguales, 'de', (data ?? []).length);
}
main().catch((e) => { console.error(e); process.exit(1); });
