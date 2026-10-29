import { describe, expect, it } from 'vitest';
import { asignadosNuevos } from '../lib/basecamp/write';

const usuarios = [
  { id: 'ana', basecamp_user_id: 1 },
  { id: 'julio', basecamp_user_id: 2 },
  { id: 'ex', basecamp_user_id: 3 }, // inactivo: también es de Geeks
  { id: 'sin_bc', basecamp_user_id: null },
];

describe('asignados del to-do al reasignar en BackIO', () => {
  it('reemplaza a la gente de Geeks y conserva a los externos (p. ej. Audela)', () => {
    expect(asignadosNuevos([1, 900, 3], ['julio'], usuarios)).toEqual([900, 2]);
  });
  it('quien no tiene Basecamp vinculado no se puede asignar allá', () => {
    expect(asignadosNuevos([1], ['sin_bc', 'julio'], usuarios)).toEqual([2]);
  });
  it('sin responsables en BackIO quedan solo los externos', () => {
    expect(asignadosNuevos([1, 900], [], usuarios)).toEqual([900]);
  });
});
