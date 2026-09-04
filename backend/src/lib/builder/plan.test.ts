import { describe, it, expect } from 'vitest';
import { planificarProyecto, redistribuirPesos, restarDias, detectarConcentracion } from './plan';
import type { PlantillaArbol } from '@backio/shared';

const plantilla: PlantillaArbol = {
  id: 'p', tenant_id: 't', nombre: 'Test', descripcion: null, tipo: 'campana', activa: true, recurrente: false, patron_nombre: null,
  bloques: [
    { id: 'b1', tenant_id: 't', plantilla_id: 'p', nombre: 'Investigación', peso: 20, orden: 1, opcional: false, tareas: [
      { id: 't1', tenant_id: 't', bloque_id: 'b1', titulo_interno: 'Kickoff', etiqueta_cliente: null, visible_cliente_default: false, peso_relativo: 1, dias_offset: 30, rol_sugerido: null, orden: 1 },
      { id: 't2', tenant_id: 't', bloque_id: 'b1', titulo_interno: 'Research', etiqueta_cliente: 'Investigación', visible_cliente_default: true, peso_relativo: 1, dias_offset: 25, rol_sugerido: null, orden: 2 },
    ]},
    { id: 'b2', tenant_id: 't', plantilla_id: 'p', nombre: 'Producción', peso: 60, orden: 2, opcional: false, tareas: [
      { id: 't3', tenant_id: 't', bloque_id: 'b2', titulo_interno: 'Piezas', etiqueta_cliente: 'Producción', visible_cliente_default: true, peso_relativo: 3, dias_offset: 5, rol_sugerido: null, orden: 1 },
      { id: 't4', tenant_id: 't', bloque_id: 'b2', titulo_interno: 'QA', etiqueta_cliente: null, visible_cliente_default: false, peso_relativo: 1, dias_offset: 2, rol_sugerido: null, orden: 2 },
    ]},
    { id: 'b3', tenant_id: 't', plantilla_id: 'p', nombre: 'Medición', peso: 20, orden: 3, opcional: true, tareas: [
      { id: 't5', tenant_id: 't', bloque_id: 'b3', titulo_interno: 'Reporte', etiqueta_cliente: 'Reporte', visible_cliente_default: true, peso_relativo: 1, dias_offset: -10, rol_sugerido: null, orden: 1 },
    ]},
  ],
};

describe('builder · planificarProyecto', () => {
  it('pesos absolutos suman 100 con todos los bloques', () => {
    const plan = planificarProyecto({ plantilla, fecha_entrega: '2026-12-15', bloques: [] });
    const suma = plan.tareas.reduce((s, t) => s + t.peso, 0);
    expect(Math.round(suma)).toBe(100);
    expect(plan.tareas.find((t) => t.titulo_interno === 'Piezas')?.peso).toBe(45); // 60 * 3/4
  });

  it('redistribuye proporcionalmente al desmarcar un bloque opcional', () => {
    const plan = planificarProyecto({
      plantilla, fecha_entrega: '2026-12-15',
      bloques: [{ bloque_id: 'b3', activo: false, owner_id: null, piezas_por_canal: {} }],
    });
    expect(plan.bloques_activos.map((b) => b.nombre)).toEqual(['Investigación', 'Producción']);
    expect(plan.bloques_activos.map((b) => b.peso)).toEqual([25, 75]);
    expect(Math.round(plan.tareas.reduce((s, t) => s + t.peso, 0))).toBe(100);
  });

  it('un bloque NO opcional no se puede desmarcar', () => {
    const plan = planificarProyecto({
      plantilla, fecha_entrega: '2026-12-15',
      bloques: [{ bloque_id: 'b2', activo: false, owner_id: null, piezas_por_canal: {} }],
    });
    expect(plan.bloques_activos.some((b) => b.id === 'b2')).toBe(true);
  });

  it('calcula fechas hacia atrás desde la entrega', () => {
    const plan = planificarProyecto({ plantilla, fecha_entrega: '2026-12-15', bloques: [] });
    expect(plan.tareas.find((t) => t.titulo_interno === 'Kickoff')?.fecha_entrega).toBe('2026-11-15');
    expect(plan.tareas.find((t) => t.titulo_interno === 'QA')?.fecha_entrega).toBe('2026-12-13');
    expect(plan.tareas.find((t) => t.titulo_interno === 'Reporte')?.fecha_entrega).toBe('2026-12-25');
  });

  it('hereda visibilidad de plantilla y cuenta visibles', () => {
    const plan = planificarProyecto({ plantilla, fecha_entrega: '2026-12-15', bloques: [] });
    expect(plan.visibles).toBe(3);
    expect(plan.tareas.filter((t) => t.visible_cliente).every((t) => t.etiqueta_cliente)).toBe(true);
  });

  it('asigna owner por bloque y suma piezas por canal', () => {
    const plan = planificarProyecto({
      plantilla, fecha_entrega: '2026-12-15',
      bloques: [{ bloque_id: 'b2', activo: true, owner_id: 'u-elias', piezas_por_canal: { Instagram: 8, Facebook: 4 } }],
    });
    const piezas = plan.tareas.find((t) => t.titulo_interno === 'Piezas');
    expect(piezas?.owner_agencia).toEqual(['u-elias']);
    expect(piezas?.piezas).toBe(12);
  });
});

describe('builder · utilidades', () => {
  it('redistribuirPesos siempre suma 100', () => {
    const m = redistribuirPesos([{ id: 'a', peso: 33 }, { id: 'b', peso: 33 }, { id: 'c', peso: 34 }], new Set(['a', 'b']));
    expect([...m.values()].reduce((s, v) => s + v, 0)).toBe(100);
  });
  it('restarDias cruza meses', () => {
    expect(restarDias('2026-03-02', 5)).toBe('2026-02-25');
  });
  it('detectarConcentracion marca >30% de una semana', () => {
    const tareas = [
      ...Array(9).fill(0).map(() => ({ fecha_entrega: '2026-08-12', owner_agencia: ['elias'] })),
      ...Array(12).fill(0).map((_, i) => ({ fecha_entrega: '2026-08-13', owner_agencia: [`otro${i}`] })),
    ];
    const a = detectarConcentracion(tareas, 30);
    expect(a).toEqual([{ owner_id: 'elias', semana_inicio: '2026-08-10', tareas: 9, total: 21, pct: 43 }]);
  });
});
