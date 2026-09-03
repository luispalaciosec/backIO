import { describe, it, expect } from 'vitest';
import { parseCSV, validarFilas } from './import';

const csv = `cliente_slug,proyecto,titulo_interno,etiqueta_cliente,visible,bloque,peso,tipo,prioridad,fecha_pedido,fecha_entrega,owner_email,piezas
cerveceria,Trade Q4,POP PROMO CADENAS,Material POP,true,Producción,3,fee,alta,2026-08-20,2026-08-31,elias@geeks.ec,29
cerveceria,Trade Q4,"Habladores, con coma",,true,Producción,1,fee,media,2026-08-20,2026-08-31,elias@geeks.ec,4
otro,Trade Q4,X,,false,Producción,1,fee,media,,,,0`;

describe('bulk import', () => {
  it('parsea comillas y comas', () => {
    const filas = parseCSV(csv);
    expect(filas).toHaveLength(3);
    expect(filas[1]?.titulo_interno).toBe('Habladores, con coma');
  });
  it('rechaza visible sin etiqueta y cliente inexistente', () => {
    const p = validarFilas(parseCSV(csv), { clientesSlug: new Set(['cerveceria']), usuariosEmail: new Set(['elias@geeks.ec']) });
    expect(p.validas).toHaveLength(1);
    expect(p.rechazadas.map((r) => r.fila)).toEqual([3, 4]);
    expect(p.rechazadas[0]?.motivo).toContain('etiqueta_cliente');
    expect(p.rechazadas[1]?.motivo).toContain('no existe');
  });
});
