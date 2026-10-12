import { describe, expect, it } from 'vitest';
import { diasHabilesEntre, esHeredada } from '../metricas';

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
