import 'dotenv/config';
import { serviceClient } from '../src/lib/db/client';
async function main() {
  const db = serviceClient();
  const { data } = await db.from('reprogramaciones').select('requerimiento_id, fecha_anterior, fecha_nueva, origen, usuario_id, motivo, created_at').eq('fecha_nueva', '2026-09-25').order('created_at', { ascending: false }).limit(8);
  console.log(JSON.stringify(data, null, 0));
  const { count } = await db.from('reprogramaciones').select('id', { count: 'exact', head: true }).eq('fecha_nueva', '2026-09-25');
  console.log('total reprogramaciones a 25/09:', count);
}
main();
