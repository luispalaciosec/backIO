import 'dotenv/config';
import { serviceClient } from '../src/lib/db/client';
const T = '00000000-0000-4000-8000-000000000001';
type R = { id: string; cliente_id: string; proyecto_id: string | null; titulo_interno: string; basecamp_todo_id: number | null; estado_operativo: string; created_at: string; fecha_entrega: string | null; bloque_nombre: string | null };
async function todas(): Promise<R[]> {
  const db = serviceClient(); const out: R[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('requerimientos').select('id, cliente_id, proyecto_id, titulo_interno, basecamp_todo_id, estado_operativo, created_at, fecha_entrega, bloque_nombre').eq('tenant_id', T).is('deleted_at', null).order('created_at').range(from, from + 999);
    const rows = (data ?? []) as R[]; out.push(...rows); if (rows.length < 1000) break;
  }
  return out;
}
async function main() {
  const db = serviceClient();
  const rows = await todas();
  const { data: cls } = await db.from('clientes').select('id, nombre, activo');
  const clientes = (cls ?? []) as { id: string; nombre: string; activo: boolean }[];
  const nc = (id: string) => clientes.find((c) => c.id === id)?.nombre ?? id;
  console.log('total requerimientos vivos:', rows.length);
  // A) mismo to-do de Basecamp
  const porTodo = new Map<number, R[]>();
  for (const r of rows) if (r.basecamp_todo_id) { const a = porTodo.get(r.basecamp_todo_id) ?? []; a.push(r); porTodo.set(r.basecamp_todo_id, a); }
  const dupTodo = [...porTodo.entries()].filter(([, a]) => a.length > 1);
  console.log('A) grupos con el mismo to-do:', dupTodo.length, 'sobrantes:', dupTodo.reduce((s, [, a]) => s + a.length - 1, 0));
  for (const [todo, a] of dupTodo.slice(0, 15)) { console.log(` to-do ${todo} "${a[0]!.titulo_interno}"`); for (const r of a) console.log(`    ${r.created_at.slice(0, 16)} ${r.estado_operativo.padEnd(12)} proy=${r.proyecto_id ? 'sí' : 'no'} ${nc(r.cliente_id)}`); }
  // B) mismo cliente + mismo título + misma fecha (activos), sin compartir to-do
  const activos = rows.filter((r) => !['completado', 'cancelado'].includes(r.estado_operativo) && clientes.find((c) => c.id === r.cliente_id)?.activo);
  const porClave = new Map<string, R[]>();
  for (const r of activos) { const k = `${r.cliente_id}|${r.titulo_interno.trim().toLowerCase()}|${r.fecha_entrega ?? ''}`; const a = porClave.get(k) ?? []; a.push(r); porClave.set(k, a); }
  const dupTit = [...porClave.entries()].filter(([, a]) => a.length > 1);
  console.log('B) grupos activos con mismo cliente+título+fecha:', dupTit.length, 'sobrantes:', dupTit.reduce((s, [, a]) => s + a.length - 1, 0));
  for (const [, a] of dupTit.slice(0, 25)) { console.log(` "${a[0]!.titulo_interno}" · ${nc(a[0]!.cliente_id)} · ${a[0]!.fecha_entrega}`); for (const r of a) console.log(`    ${r.created_at.slice(0, 16)} ${r.estado_operativo.padEnd(12)} todo=${r.basecamp_todo_id ?? '—'} proy=${r.proyecto_id ? 'sí' : 'no'} bloque=${r.bloque_nombre ?? '—'}`); }
  // C) huérfanos
  const { data: hu } = await db.from('basecamp_huerfanos').select('id, cliente_id, basecamp_todo_id, titulo, resuelto_at, resolucion').eq('tenant_id', T);
  const h = (hu ?? []) as { cliente_id: string; basecamp_todo_id: number; titulo: string; resuelto_at: string | null; resolucion: string | null }[];
  console.log('C) huérfanos:', h.length, '· pendientes:', h.filter((x) => !x.resuelto_at).length, '· adoptados:', h.filter((x) => x.resolucion === 'adoptado').length, '· de esos, ahora enlazados también por importación:', h.filter((x) => x.resolucion === 'adoptado' && (porTodo.get(x.basecamp_todo_id)?.length ?? 0) > 1).length);
  const pendYaEnl = h.filter((x) => !x.resuelto_at && porTodo.has(x.basecamp_todo_id));
  console.log('   pendientes que ya están enlazados (se pueden cerrar):', pendYaEnl.length);
}
main().catch((e) => { console.error(e); process.exit(1); });
