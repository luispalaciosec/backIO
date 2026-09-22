import 'dotenv/config';
import { serviceClient } from '../src/lib/db/client';
const T = '00000000-0000-4000-8000-000000000001';
async function main() {
  const db = serviceClient();
  const { data: cls } = await db.from('clientes').select('id, nombre').eq('tenant_id', T).eq('activo', true).ilike('nombre', '%AB-Inbev%');
  for (const c of (cls ?? []) as { id: string; nombre: string }[]) {
    const { data } = await db.from('requerimientos').select('piezas, estado_operativo, prioridad, estado_aprobacion, fecha_pedido, completado_at, created_at').eq('cliente_id', c.id).is('deleted_at', null);
    const r = (data ?? []) as { piezas: number; estado_operativo: string; prioridad: string; estado_aprobacion: string; fecha_pedido: string | null; completado_at: string | null; created_at: string }[];
    const meses: Record<string, number> = {};
    for (const x of r) { const m = (x.fecha_pedido ?? x.created_at).slice(0, 7); meses[m] = (meses[m] ?? 0) + 1; }
    console.log(c.nombre.replace(/AB-Inbev \|\|/, '').slice(0, 40), '· tareas', r.length, '· piezas', r.reduce((s, x) => s + (x.piezas || 0), 0), '· completadas', r.filter((x) => x.estado_operativo === 'completado').length, '· meses', JSON.stringify(meses));
  }
}
main();
