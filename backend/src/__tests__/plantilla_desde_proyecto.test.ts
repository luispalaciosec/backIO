import { describe, expect, it } from 'vitest';
import { bloquesDesdeProyecto } from '../lib/builder/desde_proyecto';

const req = (bloque: string, peso: number, extra: Record<string, unknown> = {}) =>
  ({
    bloque_nombre: bloque,
    peso,
    estado_operativo: 'priorizado',
    tipo_pieza_id: null,
    titulo_interno: 't',
    etiqueta_cliente: null,
    visible_cliente: false,
    fecha_entrega: '2026-10-20',
    ...extra,
  }) as never;

// B12: el peso total contaba tareas excluidas (canceladas y piezas) y el ajuste a 100 caía siempre en el último bloque.
describe('plantilla desde proyecto', () => {
  it('los pesos suman 100 y ninguno pasa de 100 aunque haya tareas excluidas', () => {
    const bloques = bloquesDesdeProyecto({
      fecha_entrega: '2026-10-31',
      requerimientos: [
        req('A', 1),
        req('B', 1),
        req('C', 1),
        req('X', 50, { estado_operativo: 'cancelado' }),
        req('Y', 50, { tipo_pieza_id: 'p' }),
      ],
    });
    expect(bloques.map((b) => b.nombre)).toEqual(['A', 'B', 'C']);
    // Tres bloques iguales: un tercio cada uno (antes 1 %, 1 % y 98 %).
    expect(bloques.map((b) => b.peso)).toEqual([33.4, 33.3, 33.3]);
    expect(Math.round(bloques.reduce((s, b) => s + b.peso, 0) * 10) / 10).toBe(100);
    expect(bloques.every((b) => b.peso > 0 && b.peso <= 100)).toBe(true);
  });
  it('desfase en días contra la entrega', () => {
    const [b] = bloquesDesdeProyecto({ fecha_entrega: '2026-10-31', requerimientos: [req('A', 1)] });
    expect(b!.tareas[0]!.dias_offset).toBe(11);
    expect(b!.peso).toBe(100);
  });
});
