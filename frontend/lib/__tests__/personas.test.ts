import { describe, expect, it } from 'vitest';
import { conNombrePersona, elegibles } from '../personas';

const ana = { id: 'a', nombre: 'Ana', activo: true };
const beto = { id: 'b', nombre: 'Beto', activo: false };

describe('personas', () => {
  it('conNombrePersona marca con (ex) a quien ya no tiene acceso', () => {
    expect(conNombrePersona([ana, beto]).map((u) => u.nombre)).toEqual(['Ana', 'Beto (ex)']);
  });
  it('elegibles ofrece solo activos, salvo el ya elegido', () => {
    expect(elegibles([ana, beto]).map((u) => u.id)).toEqual(['a']);
    expect(elegibles([ana, beto], ['b']).map((u) => u.id)).toEqual(['a', 'b']);
    expect(elegibles([ana, beto], [null]).map((u) => u.id)).toEqual(['a']);
  });
});
