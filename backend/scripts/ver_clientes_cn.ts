import 'dotenv/config';
import { serviceClient } from '../src/lib/db/client';
async function main() {
  const { data } = await serviceClient().from('clientes').select('id, nombre, slug, basecamp_project_id, mesa_id, activo').in('basecamp_project_id', [45986765, 45986697]);
  console.log(JSON.stringify(data, null, 2));
}
main();
