import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import { listPlantillas, getPlantillaArbol, guardarPlantilla, getProyectoDetalle, audit } from '../../lib/db';

export const plantillas = new Hono();

plantillas.get('/', requireScope('read:proyectos'), async (c) => {
  const cliente = c.req.query('cliente');
  const items = await listPlantillas(ctxOf(c), { clienteId: cliente || undefined, incluirInactivas: c.req.query('todas') === '1' });
  return c.json({ items, total: items.length });
});

plantillas.get('/:id', requireScope('read:proyectos'), async (c) => {
  const p = await getPlantillaArbol(ctxOf(c), c.req.param('id'));
  return p ? c.json(p) : c.json({ error: 'No encontrado' }, 404);
});

const tarea = z.object({ titulo_interno: z.string().min(1), etiqueta_cliente: z.string().nullable().optional().default(null), visible_cliente_default: z.boolean().default(false), peso_relativo: z.number().min(0).default(1), dias_offset: z.number().int().default(0), rol_sugerido: z.string().nullable().optional().default(null) });
const bloque = z.object({ nombre: z.string().min(1), peso: z.number().min(0).max(100), opcional: z.boolean().default(false), tareas: z.array(tarea).default([]) });
const schema = z.object({
  id: z.string().uuid().optional(),
  nombre: z.string().min(2), descripcion: z.string().nullable().optional(),
  tipo: z.enum(['campana', 'lanzamiento', 'fee_mensual', 'pieza_suelta', 'trade']),
  pilar: z.enum(['Marca', 'Crecimiento', 'Transformación', 'Transversal', 'Medios']).nullable().optional(),
  familia: z.string().nullable().optional(), unidad: z.string().nullable().optional(), precio_referencia: z.string().nullable().optional(),
  cliente_id: z.string().uuid().nullable().optional(), recurrente: z.boolean().default(false), patron_nombre: z.string().nullable().optional(), activa: z.boolean().default(true),
  bloques: z.array(bloque).min(1),
});

plantillas.put('/', requireScope('write:proyectos'), zValidator('json', schema), async (c) => {
  const ctx = ctxOf(c);
  const p = await guardarPlantilla(ctx, c.req.valid('json'));
  await audit(ctx, { accion: 'guardar_plantilla', entidad: 'plantilla', entidad_id: p.id, detalle: { bloques: p.bloques.length } });
  return c.json(p);
});

/** "Guardar este proyecto como plantilla": toma sus requerimientos agrupados por bloque. */
plantillas.post('/desde-proyecto/:proyectoId', requireScope('write:proyectos'), zValidator('json', z.object({ nombre: z.string().min(2), solo_cliente: z.boolean().default(false) })), async (c) => {
  const ctx = ctxOf(c);
  const det = await getProyectoDetalle(ctx, c.req.param('proyectoId'));
  if (!det) return c.json({ error: 'Proyecto no encontrado' }, 404);
  const entrega = new Date(`${det.fecha_entrega}T12:00:00Z`).getTime();
  const porBloque = new Map<string, typeof det.requerimientos>();
  for (const r of det.requerimientos.filter((x) => x.estado_operativo !== 'cancelado' && !x.tipo_pieza_id)) {
    const k = r.bloque_nombre ?? 'General';
    porBloque.set(k, [...(porBloque.get(k) ?? []), r]);
  }
  const pesoTotal = det.requerimientos.reduce((s, r) => s + Number(r.peso), 0) || 1;
  const bloques = [...porBloque.entries()].map(([nombre, reqs]) => ({
    nombre, opcional: false,
    peso: Math.round((reqs.reduce((s, r) => s + Number(r.peso), 0) / pesoTotal) * 1000) / 10,
    tareas: reqs.map((r) => ({
      titulo_interno: r.titulo_interno, etiqueta_cliente: r.etiqueta_cliente, visible_cliente_default: r.visible_cliente, peso_relativo: Number(r.peso) || 1,
      dias_offset: r.fecha_entrega ? Math.round((entrega - new Date(`${r.fecha_entrega}T12:00:00Z`).getTime()) / 86_400_000) : 0, rol_sugerido: null,
    })),
  }));
  // Ajuste para que sume 100 exacto
  const suma = bloques.reduce((s, b) => s + b.peso, 0);
  if (bloques.length && suma !== 100) bloques[bloques.length - 1]!.peso = Math.round((bloques[bloques.length - 1]!.peso + (100 - suma)) * 10) / 10;
  const b = c.req.valid('json');
  const p = await guardarPlantilla(ctx, { nombre: b.nombre, tipo: det.plantilla_id ? 'campana' : 'campana', cliente_id: b.solo_cliente ? det.cliente_id : null, descripcion: `Creada desde el proyecto "${det.nombre}"`, bloques });
  await audit(ctx, { accion: 'plantilla_desde_proyecto', entidad: 'plantilla', entidad_id: p.id, detalle: { proyecto_id: det.id } });
  return c.json(p, 201);
});
