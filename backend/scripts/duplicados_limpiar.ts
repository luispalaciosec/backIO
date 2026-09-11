import 'dotenv/config';
import { serviceClient } from '../src/lib/db/client';
const T = '00000000-0000-4000-8000-000000000001';
type R = { id: string; cliente_id: string; proyecto_id: string | null; titulo_interno: string; basecamp_todo_id: number | null; estado_operativo: string; created_at: string; fecha_entrega: string | null };
async function todas(): Promise<R[]> {
  const db = serviceClient(); const out: R[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('requerimientos').select('id, cliente_id, proyecto_id, titulo_interno, basecamp_todo_id, estado_operativo, created_at, fecha_entrega').eq('tenant_id', T).is('deleted_at', null).order('created_at').range(from, from + 999);
    const rows = (data ?? []) as R[]; out.push(...rows); if (rows.length < 1000) break;
  }
  return out;
}
async function main() {
  const db = serviceClient();
  const ahora = new Date().toISOString();
  let rows = await todas();
  const porTodo = () => { const m = new Map<number, R[]>(); for (const r of rows) if (r.basecamp_todo_id) { const a = m.get(r.basecamp_todo_id) ?? []; a.push(r); m.set(r.basecamp_todo_id, a); } return m; };
  // 1) Huérfanos adoptados cuyo requerimiento quedó sin enlace al to-do.
  const { data: hu } = await db.from('basecamp_huerfanos').select('id, basecamp_todo_id, basecamp_todolist_id, app_url, requerimiento_id').eq('tenant_id', T).eq('resolucion', 'adoptado');
  let enlazados = 0, borradosAdop = 0;
  const pt = porTodo();
  for (const h of (hu ?? []) as { id: string; basecamp_todo_id: number; basecamp_todolist_id: number | null; app_url: string | null; requerimiento_id: string | null }[]) {
    const req = rows.find((r) => r.id === h.requerimiento_id);
    if (!req || req.basecamp_todo_id) continue;
    const yaEnlazado = (pt.get(h.basecamp_todo_id) ?? []).filter((r) => r.id !== req.id);
    if (yaEnlazado.length) { await db.from('requerimientos').update({ deleted_at: ahora }).eq('id', req.id); borradosAdop += 1; rows = rows.filter((r) => r.id !== req.id); }
    else { await db.from('requerimientos').update({ basecamp_todo_id: h.basecamp_todo_id, basecamp_todolist_id: h.basecamp_todolist_id, basecamp_url: h.app_url }).eq('id', req.id); req.basecamp_todo_id = h.basecamp_todo_id; enlazados += 1; }
  }
  console.log('huérfanos adoptados: re-enlazados', enlazados, '· duplicados de importación borrados', borradosAdop);
  // 2) Duplicados por cliente + título + fecha entre activos: conservar el enlazado a Basecamp (o el más antiguo).
  const { data: cls } = await db.from('clientes').select('id, activo');
  const activosCli = new Set(((cls ?? []) as { id: string; activo: boolean }[]).filter((c) => c.activo).map((c) => c.id));
  const activos = rows.filter((r) => !['completado', 'cancelado'].includes(r.estado_operativo) && activosCli.has(r.cliente_id));
  const grupos = new Map<string, R[]>();
  for (const r of activos) { const k = `${r.cliente_id}|${r.titulo_interno.trim().toLowerCase()}|${r.fecha_entrega ?? ''}`; const a = grupos.get(k) ?? []; a.push(r); grupos.set(k, a); }
  let borrados = 0;
  for (const [, a] of grupos) {
    if (a.length < 2) continue;
    const orden = [...a].sort((x, y) => (y.basecamp_todo_id ? 1 : 0) - (x.basecamp_todo_id ? 1 : 0) || x.created_at.localeCompare(y.created_at));
    const conservar = orden[0]!;
    for (const r of orden.slice(1)) {
      // Nunca borrar dos filas enlazadas a to-dos distintos: son tareas distintas con el mismo título.
      if (r.basecamp_todo_id && conservar.basecamp_todo_id && r.basecamp_todo_id !== conservar.basecamp_todo_id) continue;
      await db.from('requerimientos').update({ deleted_at: ahora }).eq('id', r.id); borrados += 1;
      await db.from('audit_log').insert({ tenant_id: T, origen: 'ui', accion: 'eliminar_duplicado', entidad: 'requerimiento', entidad_id: r.id, detalle: { titulo: r.titulo_interno, conservado: conservar.id, motivo: 'duplicado de importación/huérfano', pedido_por: 'Luis' } });
    }
  }
  console.log('duplicados por título borrados:', borrados);
}
main().catch((e) => { console.error(e); process.exit(1); });
