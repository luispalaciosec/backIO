import 'dotenv/config';
import { serviceClient } from '../src/lib/db/client';
const T = '00000000-0000-4000-8000-000000000001';
const IDS = ['4ab18b5d-9f81-4514-8ff2-aa451962a643', '1abd618f-0edb-4996-aeef-b54f17130a03'];
async function main() {
  const db = serviceClient();
  for (const id of IDS) {
    const { data: c } = await db.from('clientes').select('nombre').eq('id', id).single();
    const { data: tareas } = await db.from('requerimientos').select('id').eq('tenant_id', T).eq('cliente_id', id).is('deleted_at', null).not('estado_operativo', 'in', '("completado","cancelado")');
    const ids = ((tareas ?? []) as { id: string }[]).map((t) => t.id);
    if (ids.length) {
      const { error } = await db.from('requerimientos').update({ estado_operativo: 'cancelado', daily_fecha: null }).in('id', ids);
      if (error) { console.error('ERROR', error.message); continue; }
    }
    const { data: proys } = await db.from('proyectos').select('id').eq('tenant_id', T).eq('cliente_id', id).is('deleted_at', null).not('estado', 'in', '("completado","cancelado")');
    const pids = ((proys ?? []) as { id: string }[]).map((p) => p.id);
    if (pids.length) await db.from('proyectos').update({ estado: 'cancelado' }).in('id', pids);
    await db.from('recurrencias').update({ activa: false }).eq('cliente_id', id);
    await db.from('audit_log').insert({ tenant_id: T, origen: 'ui', accion: 'cancelar_tareas_cliente_baja', entidad: 'cliente', entidad_id: id, detalle: { nombre: (c as { nombre: string }).nombre, tareas_canceladas: ids.length, proyectos_cancelados: pids.length, pedido_por: 'Luis' } });
    console.log((c as { nombre: string }).nombre, '→ tareas canceladas:', ids.length, '· proyectos cancelados:', pids.length);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
