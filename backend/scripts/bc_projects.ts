import 'dotenv/config';
import { BasecampClient } from '../src/lib/basecamp/client';
const T = '00000000-0000-4000-8000-000000000001';
async function main() {
  const bc = await BasecampClient.forTenant(T);
  const all = await bc.requestAll<{ id: number; name: string; status: string }>('/projects.json');
  const ab = all.filter((p) => /ab-?inbev/i.test(p.name));
  console.log(JSON.stringify(ab.map((p) => ({ id: p.id, name: p.name, status: p.status })), null, 2));
  console.log('total proyectos', all.length);
}
main().catch((e) => { console.error(e); process.exit(1); });
