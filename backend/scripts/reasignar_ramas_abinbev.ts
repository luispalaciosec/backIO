import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { serviceClient } from '../src/lib/db/client';
const T = '00000000-0000-4000-8000-000000000001';
const VIEJOS = ['4ab18b5d-9f81-4514-8ff2-aa451962a643', '1abd618f-0edb-4996-aeef-b54f17130a03'];
const NUEVOS = [
  { nombre: 'AB-Inbev · TRADE OFF', slug: 'ab-inbev-trade-off', basecamp_project_id: 45986765 },
  { nombre: 'AB-Inbev · TRADE KKAA CADENAS', slug: 'ab-inbev-trade-cadenas', basecamp_project_id: 45986697 },
];
async function main() {
  const db = serviceClient();
  // 1) Desligar Basecamp de los clientes dados de baja: sus tareas canceladas dejan de estar enlazadas a los to-dos.
  for (const id of VIEJOS) {
    const { count } = await db.from('requerimientos').select('id', { count: 'exact', head: true }).eq('cliente_id', id).not('basecamp_todo_id', 'is', null);
    await db.from('requerimientos').update({ basecamp_todo_id: null, basecamp_todolist_id: null }).eq('cliente_id', id);
    await db.from('proyectos').update({ basecamp_todolist_id: null, basecamp_todoset_id: null, basecamp_grupos: {} }).eq('cliente_id', id);
    await db.from('clientes').update({ basecamp_project_id: null, basecamp_importado_at: null }).eq('id', id);
    console.log('desligado', id, '· tareas desenlazadas:', count);
  }
  // 2) Crear las ramas con los nombres nuevos.
  for (const r of NUEVOS) {
    const { data: ex } = await db.from('clientes').select('id, nombre').eq('tenant_id', T).eq('slug', r.slug).maybeSingle();
    if (ex) { console.log('ya existe', (ex as { nombre: string }).nombre); continue; }
    const { data, error } = await db.from('clientes').insert({ id: randomUUID(), tenant_id: T, nombre: r.nombre, slug: r.slug, basecamp_project_id: r.basecamp_project_id, color_primario: '#F5B400', activo: true, config: { origen: 'manual', grupo: 'AB-Inbev' } }).select('id, nombre').single();
    if (error) { console.error('ERROR', r.nombre, error.message); continue; }
    await db.from('audit_log').insert({ tenant_id: T, origen: 'ui', accion: 'crear_cliente', entidad: 'cliente', entidad_id: (data as { id: string }).id, detalle: { nombre: r.nombre, basecamp_project_id: r.basecamp_project_id, origen: 'manual', reemplaza_a: VIEJOS } });
    console.log('creado', (data as { id: string }).id, r.nombre);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
