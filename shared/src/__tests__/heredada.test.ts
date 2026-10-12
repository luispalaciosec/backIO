import { describe, expect, it } from 'vitest';
import { cerradaATiempo, diasHabilesEntre, esHeredada, responsablesDe, responsablesEn } from '../metricas';

// 2026-10-09 es viernes.
describe('regla de gracia de tareas heredadas', () => {
  it('cuenta solo días hábiles después de hoy', () => {
    expect(diasHabilesEntre('2026-10-09', '2026-10-12')).toBe(1); // sáb y dom no cuentan
    expect(diasHabilesEntre('2026-10-09', '2026-10-14')).toBe(3);
    expect(diasHabilesEntre('2026-10-09', '2026-10-09')).toBe(0);
    expect(diasHabilesEntre('2026-10-09', '2026-10-01')).toBe(0);
  });
  it('heredada con menos de 3 días hábiles, vencida o para hoy; nunca sin fecha', () => {
    expect(esHeredada('2026-10-13', '2026-10-09')).toBe(true); // 2 hábiles
    expect(esHeredada('2026-10-14', '2026-10-09')).toBe(false); // 3 hábiles
    expect(esHeredada('2026-10-09', '2026-10-09')).toBe(true);
    expect(esHeredada('2026-10-01', '2026-10-09')).toBe(true);
    expect(esHeredada(null, '2026-10-09')).toBe(false);
  });
});

describe('métricas con salidas', () => {
  it('una heredada cerrada tarde no cuenta (null); a tiempo sí cuenta', () => {
    const tarde = '2026-10-15T15:00:00Z';
    expect(cerradaATiempo(tarde, '2026-10-14')).toBe(false);
    expect(cerradaATiempo(tarde, '2026-10-14', true)).toBeNull();
    expect(cerradaATiempo(tarde, '2026-10-15', true)).toBe(true);
  });
  it('lo completado cuenta para sus responsables al cierre', () => {
    expect(responsablesDe({ estado_operativo: 'completado', owner_agencia: ['b'], responsables_cierre: ['a'] })).toEqual(['a']);
    expect(responsablesDe({ estado_operativo: 'completado', owner_agencia: ['b'], responsables_cierre: null })).toEqual(['b']);
    expect(responsablesDe({ estado_operativo: 'en_ejecucion', owner_agencia: ['b'], responsables_cierre: ['a'] })).toEqual(['b']);
  });
  it('responsables en un instante según el historial', () => {
    const tramos = [
      { requerimiento_id: 'r', usuario_id: 'a', desde: '2026-10-01T00:00:00Z', hasta: '2026-10-10T00:00:00Z' },
      { requerimiento_id: 'r', usuario_id: 'b', desde: '2026-10-10T00:00:00Z', hasta: null },
    ];
    expect(responsablesEn(tramos, '2026-10-05T00:00:00Z', ['b'])).toEqual(['a']);
    expect(responsablesEn(tramos, '2026-10-11T00:00:00Z', ['b'])).toEqual(['b']);
    expect(responsablesEn([], '2026-10-05T00:00:00Z', ['b'])).toEqual(['b']);
  });
});
