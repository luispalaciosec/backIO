/**
 * Plantilla a partir de un proyecto: bloques con su peso y tareas con su desfase respecto a la entrega.
 * Función pura para poder probarla (auditoría 10/10, B12).
 */
import type { ProyectoDetalle } from '@backio/shared';

export function bloquesDesdeProyecto(det: Pick<ProyectoDetalle, 'fecha_entrega' | 'requerimientos'>) {
  const entrega = new Date(`${det.fecha_entrega}T12:00:00Z`).getTime();
  // Se excluyen canceladas y piezas (las piezas salen de los tipos de pieza, no de la plantilla).
  const incluidas = det.requerimientos.filter((x) => x.estado_operativo !== 'cancelado' && !x.tipo_pieza_id);
  const porBloque = new Map<string, typeof incluidas>();
  for (const r of incluidas) {
    const k = r.bloque_nombre ?? 'General';
    porBloque.set(k, [...(porBloque.get(k) ?? []), r]);
  }
  // El peso se reparte entre las tareas incluidas: antes el total contaba también las excluidas y el ajuste a 100
  // podía dejar un bloque con más de 100.
  const pesoTotal = incluidas.reduce((s, r) => s + Number(r.peso), 0) || 1;
  const bloques = [...porBloque.entries()].map(([nombre, reqs]) => ({
    nombre,
    opcional: false,
    peso: Math.round((reqs.reduce((s, r) => s + Number(r.peso), 0) / pesoTotal) * 1000) / 10,
    tareas: reqs.map((r) => ({
      titulo_interno: r.titulo_interno,
      etiqueta_cliente: r.etiqueta_cliente,
      visible_cliente_default: r.visible_cliente,
      peso_relativo: Number(r.peso) || 1,
      dias_offset: r.fecha_entrega ? Math.round((entrega - new Date(`${r.fecha_entrega}T12:00:00Z`).getTime()) / 86_400_000) : 0,
      rol_sugerido: null,
    })),
  }));
  // El redondeo puede dejar 99,9 o 100,1: la diferencia va al bloque más pesado.
  const suma = Math.round(bloques.reduce((s, b) => s + b.peso, 0) * 10) / 10;
  const mayor = bloques.reduce<(typeof bloques)[number] | null>((m, b) => (!m || b.peso > m.peso ? b : m), null);
  if (mayor && suma !== 100) mayor.peso = Math.round((mayor.peso + (100 - suma)) * 10) / 10;
  return bloques;
}
