import 'dotenv/config';
import { serviceClient } from '../src/lib/db/client';
async function main() {
  const db = serviceClient();
  const desde = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const out: Record<string, number> = {}; const acc: Record<string, number> = {};
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('audit_log').select('origen, accion, usuario_id').gte('created_at', desde).range(from, from + 999);
    const rows = (data ?? []) as { origen: string; accion: string; usuario_id: string | null }[];
    for (const r of rows) { out[`${r.origen}${r.usuario_id ? '' : ' (sin usuario)'}`] = (out[`${r.origen}${r.usuario_id ? '' : ' (sin usuario)'}`] ?? 0) + 1; if (r.usuario_id) acc[r.accion] = (acc[r.accion] ?? 0) + 1; }
    if (rows.length < 1000) break;
  }
  console.log('por origen 7d:', out); console.log('acciones de usuarios 7d:', acc);
}
main();
