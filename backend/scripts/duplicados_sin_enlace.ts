/**
 * Pares duplicados: mismo cliente y mismo título, uno enlazado a Basecamp y otro sin enlace (creado a mano,
 * por recurrencia o por Builder antes de que la importación trajera el to-do real). El que no tiene enlace
 * sobra: se da de baja lógica (queda en auditoría). `--ver` solo lista.
 */
import 'dotenv/config';
import { serviceClient } from '../src/lib/db/client';
const T = '00000000-0000-4000-8000-000000000001';
const ver = process.argv.includes('--ver');
async function main() {
  const db = serviceClient();
  const todas: { id: string; titulo_interno: string; cliente_id: string; basecamp_todo_id: number | null; estado_operativo: string; created_at: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('requerimientos').select('id, titulo_interno, cliente_id, basecamp_todo_id, estado_operativo, created_at').eq('tenant_id', T).is('deleted_at', null).order('id').range(from, from + 999);
    todas.push(...((data ?? []) as typeof todas)); if ((data ?? []).length < 1000) break;
  }
  const m = new Map<string, typeof todas>();
  for (const x of todas) { const k = `${x.cliente_id}|${x.titulo_interno.trim().toLowerCase()}`; m.set(k, [...(m.get(k) ?? []), x]); }
  const sobran: typeof todas = [];
  for (const xs of m.values()) {
    const con = xs.filter((x) => x.basecamp_todo_id), sin = xs.filter((x) => !x.basecamp_todo_id);
    if (con.length && sin.length) for (const s of sin.filter((x) => x.estado_operativo !== 'completado')) { console.log(`${s.titulo_interno.slice(0, 55).padEnd(55)} sin bc: ${s.estado_operativo} (creado ${s.created_at.slice(0, 10)}) · con bc: ${con.map((c) => c.estado_operativo).join(',')}`); sobran.push(s); }
  }
  console.log('total', todas.length, '· duplicados sin enlace:', sobran.length);
  if (ver || !sobran.length) return;
  const { error } = await db.from('requerimientos').update({ deleted_at: new Date().toISOString() }).in('id', sobran.map((s) => s.id));
  if (error) throw error;
  await db.from('audit_log').insert(sobran.map((s) => ({ tenant_id: T, origen: 'script', accion: 'duplicado_eliminado', entidad: 'requerimiento', entidad_id: s.id, detalle: { titulo: s.titulo_interno, motivo: 'duplicado sin enlace a Basecamp; existe el mismo título enlazado', pedido_por: 'Carolina Suárez 24/09' } })));
  console.log('dados de baja:', sobran.length);
}
main().catch((e) => { console.error(e); process.exit(1); });
