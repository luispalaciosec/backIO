import { describe, expect, it } from 'vitest';
import { diaLocal, finDiaLocal, hoyLocal, inicioDiaLocal, lunesDe, sumarDias } from '../fechas';
import { formatoFraccion, porcentaje } from '../metricas';

describe('fechas en hora de Guayaquil', () => {
  it('un cierre a las 19:30 de Guayaquil pertenece a ese día, no al siguiente (B4)', () => {
    expect(diaLocal('2026-10-09T00:30:00Z')).toBe('2026-10-08');
    expect(diaLocal('2026-10-09T05:00:00Z')).toBe('2026-10-09');
  });
  it('fechas sin hora y nulos pasan tal cual', () => {
    expect(diaLocal('2026-10-09')).toBe('2026-10-09');
    expect(diaLocal(null)).toBeNull();
  });
  it('hoy a las 20:00 de Guayaquil sigue siendo hoy aunque en UTC ya sea mañana (B5)', () => {
    expect(hoyLocal(new Date('2026-10-10T01:00:00Z'))).toBe('2026-10-09');
  });
  it('lunes, sumas y bordes del día', () => {
    expect(lunesDe('2026-10-11')).toBe('2026-10-05'); // domingo
    expect(lunesDe('2026-10-05')).toBe('2026-10-05');
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(inicioDiaLocal('2026-10-09')).toBe('2026-10-09T05:00:00.000Z');
    expect(finDiaLocal('2026-10-09')).toBe('2026-10-10T04:59:59.000Z');
  });
  it('porcentajes', () => {
    expect(porcentaje(1, 3)).toBe(33);
    expect(porcentaje(1, 0)).toBeNull();
    expect(formatoFraccion(0.875)).toBe('87.5%');
    expect(formatoFraccion(null)).toBe('—');
  });
});
