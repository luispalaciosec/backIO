import { describe, expect, it } from 'vitest';
import { aTiempoOriginal, aTiempoVigente, resumirCumplimiento } from '../lib/cumplimiento';

// Auditoría 10/10, B4: «a tiempo» tomaba el día UTC del cierre. Una tarea cerrada a las 19:30 de Guayaquil del día
// de entrega (00:30 UTC del día siguiente) contaba como atrasada en cumplimiento y a tiempo en KPIs.
describe('a tiempo en hora de Guayaquil', () => {
  const cerradaLaNoche = { completado_at: '2026-10-09T00:30:00Z', fecha_entrega_original: '2026-10-08', fecha_entrega: '2026-10-08' };

  it('cierre a las 19:30 del día de entrega cuenta a tiempo', () => {
    expect(aTiempoOriginal(cerradaLaNoche)).toBe(true);
    expect(aTiempoVigente(cerradaLaNoche)).toBe(true);
  });

  it('cierre a la 00:30 del día siguiente (hora local) es tarde', () => {
    const tarde = { ...cerradaLaNoche, completado_at: '2026-10-09T05:30:00Z' };
    expect(aTiempoOriginal(tarde)).toBe(false);
  });

  it('el resumen usa la misma regla', () => {
    const r = resumirCumplimiento([{ ...cerradaLaNoche, id: 'r1' } as never], [], []);
    expect(r.pct_original).toBe(100);
  });
});
