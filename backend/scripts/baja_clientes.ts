import 'dotenv/config';
import { serviceClient } from '../src/lib/db/client';
const T = '00000000-0000-4000-8000-000000000001';
const IDS = ['4ab18b5d-9f81-4514-8ff2-aa451962a643', '1abd618f-0edb-4996-aeef-b54f17130a03'];
async function main() {
  const db = serviceClient();
  for (const id of IDS) {
    const { data: c } = await db.from('clientes').select('id, nombre, activo').eq('tenant_id', T).eq('id', id).maybeSingle();
    if (!c) { console.log('no existe', id); continue; }
    const { error } = await db.from('clientes').update({ activo: false }).eq('id', id);
    if (error) { console.error('ERROR', id, error.message); continue; }
    await db.from('audit_log').insert({ tenant_id: T, origen: 'ui', accion: 'baja_cliente', entidad: 'cliente', entidad_id: id, detalle: { nombre: (c as { nombre: string }).nombre, pedido_por: 'Luis (dividido en ramas AB-Inbev)' } });
    const { count } = await db.from('requerimientos').select('id', { count: 'exact', head: true }).eq('cliente_id', id).is('deleted_at', null).not('estado_operativo', 'in', '("completado","cancelado")');
    console.log('baja', (c as { nombre: string }).nombre, '· tareas activas que quedan asociadas:', count);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
