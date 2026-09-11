import 'dotenv/config';
import { serviceClient } from '../src/lib/db/client';
import { randomUUID } from 'node:crypto';
const T = '00000000-0000-4000-8000-000000000001';
const RAMAS: { nombre: string; slug: string; basecamp_project_id: number }[] = [
  { nombre: 'AB-Inbev · OFFline ON', slug: 'ab-inbev-offline-on', basecamp_project_id: 48850050 },
  { nombre: 'AB-Inbev · OFFline OFF', slug: 'ab-inbev-offline-off', basecamp_project_id: 45986765 },
  { nombre: 'AB-Inbev · OFFline HIGH END', slug: 'ab-inbev-offline-high-end', basecamp_project_id: 48850069 },
  { nombre: 'AB-Inbev · OFFline EVENTOS', slug: 'ab-inbev-offline-eventos', basecamp_project_id: 48850085 },
  { nombre: 'AB-Inbev · TRADE KKAA MINIMARKETS', slug: 'ab-inbev-trade-minimarkets', basecamp_project_id: 48853050 },
  { nombre: 'AB-Inbev · TRADE KKAA ECOMM', slug: 'ab-inbev-trade-ecomm', basecamp_project_id: 48853198 },
  { nombre: 'AB-Inbev · TRADE KKAA CADENAS', slug: 'ab-inbev-trade-cadenas', basecamp_project_id: 45986697 },
];
async function main() {
  const db = serviceClient();
  for (const r of RAMAS) {
    const { data: ex } = await db.from('clientes').select('id, nombre').eq('tenant_id', T).or(`slug.eq.${r.slug},basecamp_project_id.eq.${r.basecamp_project_id}`).maybeSingle();
    if (ex) { console.log('ya existe', (ex as { nombre: string }).nombre); continue; }
    const { data, error } = await db.from('clientes').insert({ id: randomUUID(), tenant_id: T, nombre: r.nombre, slug: r.slug, basecamp_project_id: r.basecamp_project_id, color_primario: '#F5B400', activo: true, config: { origen: 'manual', grupo: 'AB-Inbev' } }).select('id, nombre').single();
    if (error) { console.error('ERROR', r.nombre, error.message); continue; }
    console.log('creado', (data as { id: string; nombre: string }).id, (data as { nombre: string }).nombre);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
