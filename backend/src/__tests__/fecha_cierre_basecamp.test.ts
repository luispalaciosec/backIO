import { describe, expect, it } from 'vitest';
import { fechaDeCierre } from '../lib/basecamp/campos';
import { extractSafeTodo } from '../lib/basecamp/sync';

// 28/10/2026: Basecamp 3 no tiene `completed_at`; la fecha está en `completion.created_at`. BackIO leía el campo que no
// existe y 1.453 completadas quedaron sin fecha de cierre.
describe('fecha de cierre de un to-do de Basecamp', () => {
  const vivo = { id: 7, completed: true, completion: { created_at: '2026-09-07T13:02:47.456Z' }, updated_at: '2026-09-07T13:02:47Z' };
  it('sale de completion.created_at', () => {
    expect(fechaDeCierre(vivo)).toBe('2026-09-07T13:02:47.456Z');
    expect(extractSafeTodo(vivo)?.completed_at).toBe('2026-09-07T13:02:47.456Z');
  });
  it('un to-do abierto no tiene fecha de cierre', () => {
    expect(fechaDeCierre({ completed: false, completion: { created_at: '2026-09-07T13:02:47Z' } })).toBeNull();
  });
  it('si viniera completed_at (formato viejo), se usa', () => {
    expect(fechaDeCierre({ completed: true, completed_at: '2026-09-01T10:00:00Z' })).toBe('2026-09-01T10:00:00Z');
  });
  it('del to-do solo entra la fecha, nunca el resto de completion', () => {
    const safe = extractSafeTodo({ ...vivo, completion: { created_at: '2026-09-07T13:02:47.456Z', creator: { name: 'Ana' } } });
    expect(JSON.stringify(safe)).not.toContain('Ana');
  });
});
