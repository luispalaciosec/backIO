import 'dotenv/config';
import { BasecampClient } from '../src/lib/basecamp/client';
import { serviceClient } from '../src/lib/db/client';
const T = '00000000-0000-4000-8000-000000000001';
async function main() {
  const bc = await BasecampClient.forTenant(T);
  const all = await bc.requestAll<{ id: number; name: string }>('/projects.json');
  const db = serviceClient();
  const { data: cls } = await db.from('clientes').select('id, nombre, basecamp_project_id').eq('tenant_id', T).eq('activo', true).not('basecamp_project_id', 'is', null);
  for (const c of (cls ?? []) as { id: string; nombre: string; basecamp_project_id: number }[]) {
    const p = all.find((x) => x.id === c.basecamp_project_id);
    if (!p || !/ab-?inbev/i.test(p.name)) continue;
    const nombre = p.name.replace(/[​‌‍﻿]/g, '').replace(/\s+/g, ' ').trim();
    if (nombre === c.nombre) { console.log('igual', nombre); continue; }
    const { error } = await db.from('clientes').update({ nombre }).eq('id', c.id);
    if (error) { console.error('ERROR', c.nombre, error.message); continue; }
    await db.from('audit_log').insert({ tenant_id: T, origen: 'ui', accion: 'renombrar_cliente', entidad: 'cliente', entidad_id: c.id, detalle: { de: c.nombre, a: nombre, fuente: 'nombre del proyecto Basecamp' } });
    console.log(`${c.nombre}  →  ${nombre}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
