import { describe, expect, it } from 'vitest';
import { describir } from '../lib/actividad';

describe('describir (tabla de frases de la actividad)', () => {
  it('acciones fijas y con detalle', () => {
    expect(describir('crear', {})).toBe('creó la tarea');
    expect(describir('reprogramar', { de: '2026-10-01', a: '2026-10-05' })).toBe('movió la entrega del 01/10 al 05/10');
    expect(describir('quitar_acceso', {})).toBe('quitó el acceso a un usuario');
  });
  it('actualizar junta los cambios con las etiquetas compartidas', () => {
    expect(describir('actualizar', { estado_operativo: 'en_ejecucion', estado_aprobacion: 'rechazado', daily_fecha: null })).toBe(
      'estado → En proceso · aprobación → Cambios solicitados · la quitó del daily',
    );
    expect(describir('actualizar', {})).toBe('actualizó la tarea');
  });
  it('acciones desconocidas (incluidas las de Object.prototype) se leen por su nombre', () => {
    expect(describir('algo_nuevo', {})).toBe('algo nuevo');
    expect(describir('toString', {})).toBe('toString');
  });
});
