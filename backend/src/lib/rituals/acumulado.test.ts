import { describe, expect, it } from 'vitest';
import { semaforo } from '@backio/shared';
import { armarAcumulado, estadoEnSemana, mensajeDeEnlace, SIN_EQUIPO } from './acumulado';
import type { TareaEvo } from '../evolutivo';

const SEMANA = { inicio: '2026-11-09', fin: '2026-11-15' };
const t = (p: Partial<TareaEvo>): TareaEvo => ({
  id: 'x',
  owner_agencia: ['ana'],
  estado_operativo: 'en_ejecucion',
  completado_at: null,
  created_at: '2026-10-01T15:00:00Z',
  planificacion: 'planificado',
  fecha_entrega: '2026-11-12',
  fecha_entrega_original: '2026-11-12',
  daily_fecha: null,
  piezas: 1,
  cliente_id: 'c1',
  titulo_interno: 'Tarea',
  estado_aprobacion: 'no_aplica',
  ...p,
});
const sem = (p: Partial<{ cerradaEnSemana: boolean; conAjustes: boolean }> = {}) => ({
  ...SEMANA,
  cerradaEnSemana: false,
  conAjustes: false,
  ...p,
});

describe('estado de una tarea en la semana', () => {
  it('sigue el orden: terminada, revisión, ajustes, no cumplida, nueva, en curso', () => {
    expect(estadoEnSemana(t({ estado_aprobacion: 'pendiente_cliente' }), sem({ cerradaEnSemana: true }))).toBe('terminada');
    expect(estadoEnSemana(t({ estado_aprobacion: 'pendiente_cliente' }), sem({ conAjustes: true }))).toBe('revision');
    expect(estadoEnSemana(t({}), sem({ conAjustes: true }))).toBe('ajustes');
    expect(estadoEnSemana(t({ estado_aprobacion: 'rechazado' }), sem())).toBe('ajustes');
    expect(estadoEnSemana(t({ fecha_entrega: '2026-11-12' }), sem())).toBe('no_cumplida');
    expect(estadoEnSemana(t({ fecha_entrega: '2026-11-20', fecha_pedido: '2026-11-10' }), sem())).toBe('nueva');
    expect(estadoEnSemana(t({ fecha_entrega: '2026-11-20' }), sem())).toBe('en_curso');
    expect(estadoEnSemana(t({ fecha_entrega: null }), sem())).toBe('en_curso');
  });
});

describe('acumulado de la semana', () => {
  const tareas = [
    // Terminada el miércoles, de dos personas: cuenta una vez en el equipo.
    t({ id: 'a', owner_agencia: ['ana', 'beto'], fecha_entrega: '2026-11-11', completado_at: '2026-11-11T20:00:00Z', piezas: 10 }),
    // En revisión del cliente: sus piezas ya salieron.
    t({
      id: 'b',
      owner_agencia: ['beto'],
      fecha_entrega: '2026-11-13',
      estado_aprobacion: 'pendiente_cliente',
      piezas: 4,
      cliente_id: 'c2',
    }),
    // Vencía el jueves y no se cerró.
    t({ id: 'c', fecha_entrega: '2026-11-12', piezas: 3 }),
    // Se entrega la semana siguiente y se trabajó (elegida el lunes): en curso, sin piezas realizadas.
    t({ id: 'd', fecha_entrega: '2026-11-18', piezas: 7 }),
    // Fuera de la semana: no entra.
    t({ id: 'z', fecha_entrega: '2026-12-01' }),
  ];
  const selecciones = new Map([
    ['2026-11-09', new Set(['d'])],
    ['2026-11-11', new Set(['a'])],
    ['2026-11-12', new Set(['c'])],
    ['2026-11-13', new Set(['b'])],
  ]);
  const datos = {
    tareas,
    reprocesos: [],
    reprogramaciones: [],
    nombres: new Map([
      ['ana', 'Ana'],
      ['beto', 'Beto'],
    ]),
    avance: [],
    cierres: [],
  };
  const a = armarAcumulado({
    datos,
    semana: SEMANA,
    selecciones,
    hoy: '2026-11-20',
    reprocesosAbiertos: new Set(),
    equipoDe: new Map([['c1', 'KKAA']]),
    clientes: new Map([
      ['c1', 'Cadenas'],
      ['c2', 'Eventos'],
    ]),
  });

  it('cuenta cada tarea una vez, con su estado, y suma las piezas realizadas', () => {
    expect(a.resumen.total).toBe(4);
    expect(a.resumen.por_estado).toMatchObject({ terminada: 1, revision: 1, no_cumplida: 1, en_curso: 1 });
    expect(a.resumen.piezas).toBe(14); // 10 terminada + 4 en revisión; lo no cumplido y en curso no suma
  });

  it('cumplimiento: entregadas (terminadas y en revisión del cliente) ÷ lo que tocaba entregar, cada tarea una vez', () => {
    // a ✅ y b 🔎 entregadas; c ❌ pendiente; d 🛠️ en curso no entra.
    expect({ e: a.resumen.cerradas_plan, c: a.resumen.para_entregar }).toEqual({ e: 2, c: 3 });
    expect(a.resumen.cumplimiento_pct).toBe(67);
    expect(a.resumen.semaforo).toBe('rojo');
  });

  it('una tarea que se arrastró varios días cuenta una sola vez (caso real: 7 entregadas y 1 pendiente = 88 %)', () => {
    const ts = [
      ...Array.from({ length: 7 }, (_, i) => t({ id: `ok${i}`, fecha_entrega: '2026-11-12', completado_at: '2026-11-12T20:00:00Z' })),
      t({ id: 'pend', fecha_entrega: '2026-11-10' }),
    ];
    // La pendiente se eligió los cinco días sin cerrarse: antes contaba 5 veces.
    const sel = new Map(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].map((d) => [d, new Set(['pend'])]));
    const r = armarAcumulado({
      datos: { ...datos, tareas: ts },
      semana: SEMANA,
      selecciones: sel,
      hoy: '2026-11-20',
      reprocesosAbiertos: new Set(),
      equipoDe: new Map(),
      clientes: new Map(),
    });
    expect(r.resumen).toMatchObject({ cerradas_plan: 7, para_entregar: 8, cumplimiento_pct: 88, semaforo: 'amarillo' });
  });

  it('agrupa por equipo y persona; la tarea compartida aparece en las dos personas con «con ayuda de»', () => {
    expect(a.equipos.map((e) => e.nombre)).toEqual(['KKAA', SIN_EQUIPO]);
    const kkaa = a.equipos[0]!;
    expect(kkaa.total).toBe(3);
    const beto = kkaa.personas.find((p) => p.nombre === 'Beto')!;
    expect(beto.tareas.map((x) => x.id)).toEqual(['a']);
    expect(beto.tareas[0]!.con_ayuda_de).toEqual(['Ana']);
    expect(a.equipos[1]!.personas[0]!.tareas[0]).toMatchObject({ id: 'b', estado: 'revision', cliente: 'Eventos' });
  });
});

describe('semáforo único', () => {
  it('verde desde 90, amarillo desde 70', () => {
    expect([semaforo(90), semaforo(89), semaforo(70), semaforo(69), semaforo(null)]).toEqual([
      'verde',
      'amarillo',
      'amarillo',
      'rojo',
      null,
    ]);
  });
});

describe('enlace del mensaje de Basecamp', () => {
  it('saca proyecto y mensaje; rechaza otros enlaces', () => {
    expect(mensajeDeEnlace('https://3.basecamp.com/4186385/buckets/41904747/messages/10490201049')).toEqual({
      proyecto: 41904747,
      mensaje: 10490201049,
    });
    expect(mensajeDeEnlace('https://3.basecamp.com/4186385/buckets/41904747/todos/1')).toBeNull();
    expect(mensajeDeEnlace('https://evil.com/4186385/buckets/1/messages/2')).toBeNull();
  });
});
