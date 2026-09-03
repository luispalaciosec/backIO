import { describe, it, expect } from 'vitest';
import {
  sanitizeForClient,
  assertClientSafe,
  mapEstadoCliente,
  type SanitizableRequirement,
} from '../visibility/sanitize';

let seq = 0;
const proyecto = { nombre: 'Campaña Navidad 2026', fecha_entrega: '2026-12-15' };

function req(partial: Partial<SanitizableRequirement> & { id?: string }): SanitizableRequirement {
  return {
    id: partial.id ?? `r${++seq}`,
    etiqueta_cliente: null,
    visible_cliente: false,
    peso: 1,
    estado_operativo: 'backlog',
    estado_aprobacion: 'no_aplica',
    fecha_entrega: null,
    ultima_actualizacion: new Date().toISOString(),
    ...partial,
  };
}

describe('frontera de visibilidad · sanitizeForClient', () => {
  it('nunca expone titulo_interno (ni siquiera si viene en el objeto)', () => {
    const conTexto = [
      { ...req({ visible_cliente: false, peso: 10 }), titulo_interno: 'Ruta creativa v3 - la mala' },
      { ...req({ visible_cliente: true, etiqueta_cliente: 'Entrega', peso: 10 }), titulo_interno: 'Entrega' },
    ] as unknown as SanitizableRequirement[];
    const out = sanitizeForClient(proyecto, conTexto);
    expect(JSON.stringify(out)).not.toContain('la mala');
    expect(JSON.stringify(out)).not.toContain('titulo_interno');
    expect(out.hitos).toHaveLength(1);
    expect(() => assertClientSafe(out)).not.toThrow();
  });

  it('renormaliza el avance sobre visibles', () => {
    const out = sanitizeForClient(proyecto, [
      req({ visible_cliente: true, peso: 50, estado_operativo: 'completado', etiqueta_cliente: 'A' }),
      req({ visible_cliente: true, peso: 50, estado_operativo: 'backlog', etiqueta_cliente: 'B' }),
      req({ visible_cliente: false, peso: 100, estado_operativo: 'completado' }),
    ]);
    expect(out.avance).toBe(50); // no 66
  });

  it('tabla de renormalización del doc 02', () => {
    const filas: [string, number, boolean, boolean][] = [
      ['Kickoff interno', 5, false, true],
      ['Research', 10, true, true],
      ['Ruta creativa v1', 10, false, true],
      ['Revisión DA', 5, false, true],
      ['Ruta creativa v2', 10, false, true],
      ['Presentación concepto', 15, true, true],
      ['Ajustes', 10, true, false],
      ['Producción', 25, true, false],
      ['QA', 5, false, false],
      ['Entrega final', 5, true, false],
    ];
    const reqs = filas.map(([t, peso, vis, done]) =>
      req({
        etiqueta_cliente: vis ? t : null,
        visible_cliente: vis,
        peso,
        estado_operativo: done ? 'completado' : 'backlog',
      }),
    );
    const out = sanitizeForClient(proyecto, reqs);
    // visibles: 10+15+10+25+5 = 65 ; hechos visibles: 10+15 = 25 → 38%
    expect(out.avance).toBe(38);
    expect(out.hitos).toHaveLength(5);
  });

  it('colapsa estados internos a en_proceso', () => {
    const out = sanitizeForClient(proyecto, [
      req({ visible_cliente: true, peso: 1, estado_operativo: 'bloqueado', etiqueta_cliente: 'X' }),
      req({ visible_cliente: true, peso: 1, estado_operativo: 'reprogramado', etiqueta_cliente: 'Y' }),
      req({ visible_cliente: true, peso: 1, estado_operativo: 'en_revision', etiqueta_cliente: 'Z' }),
    ]);
    expect(out.hitos.map((h) => h.estado)).toEqual(['en_proceso', 'en_proceso', 'en_proceso']);
    // Los estados internos no aparecen en ningún hito (la clave bloqueado_por_cliente es parte del contrato)
    expect(JSON.stringify(out.hitos)).not.toMatch(/bloqueado|reprogramado|atras|revision/);
  });

  it('descarta visibles sin etiqueta aunque visible_cliente sea true', () => {
    const out = sanitizeForClient(proyecto, [
      req({ visible_cliente: true, etiqueta_cliente: null, peso: 10, estado_operativo: 'completado' }),
      req({ visible_cliente: true, etiqueta_cliente: 'OK', peso: 10 }),
    ]);
    expect(out.hitos).toHaveLength(1);
    expect(out.avance).toBe(0);
  });

  it('calcula esperando_cliente con contador de días', () => {
    const hace4 = new Date(Date.now() - 4 * 86_400_000).toISOString();
    const out = sanitizeForClient(proyecto, [
      req({
        visible_cliente: true,
        etiqueta_cliente: 'Propuesta creativa',
        estado_aprobacion: 'pendiente_cliente',
        estado_operativo: 'en_revision',
        ultima_actualizacion: hace4,
      }),
    ]);
    expect(out.bloqueado_por_cliente).toEqual([{ titulo: 'Propuesta creativa', dias: 4 }]);
    expect(out.hitos[0]?.esperando_cliente).toBe(true);
  });

  it('proyecto sin visibles → avance 0, sin hitos', () => {
    const out = sanitizeForClient(proyecto, [req({ visible_cliente: false, estado_operativo: 'completado' })]);
    expect(out).toMatchObject({ avance: 0, hitos: [], bloqueado_por_cliente: [] });
  });

  it('mapEstadoCliente cubre todos los estados', () => {
    expect(mapEstadoCliente('completado')).toBe('completado');
    expect(mapEstadoCliente('backlog')).toBe('pendiente');
    expect(mapEstadoCliente('priorizado')).toBe('pendiente');
    expect(mapEstadoCliente('en_ejecucion')).toBe('en_proceso');
    expect(mapEstadoCliente('cancelado')).toBe('en_proceso');
  });

  it('assertClientSafe detecta campos prohibidos', () => {
    expect(() => assertClientSafe({ hitos: [{ peso: 3 }] })).toThrow(/peso/);
    expect(() => assertClientSafe({ x: { basecamp_url: 'u' } })).toThrow(/basecamp/);
  });
});
