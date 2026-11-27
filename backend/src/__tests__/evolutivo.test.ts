import { describe, it, expect } from 'vitest';
import {
  reconstruirSeleccion,
  metricasDia,
  metricasSemana,
  diasHabiles,
  semanaDe,
  inicioDia,
  finDia,
  resumir,
  type TareaEvo,
} from '../lib/evolutivo';

const t = (p: Partial<TareaEvo>): TareaEvo => ({
  id: 'x',
  owner_agencia: ['ana'],
  estado_operativo: 'priorizado',
  completado_at: null,
  created_at: '2026-09-01T15:00:00Z',
  planificacion: 'planificado',
  fecha_entrega: null,
  fecha_entrega_original: null,
  daily_fecha: null,
  ...p,
});

describe('fechas', () => {
  it('días hábiles y semana ISO', () => {
    expect(diasHabiles('2026-09-25', '2026-09-29')).toEqual(['2026-09-25', '2026-09-28', '2026-09-29']);
    expect(semanaDe('2026-09-24')).toEqual({ inicio: '2026-09-21', fin: '2026-09-27' });
    expect(inicioDia('2026-09-24')).toBe('2026-09-24T05:00:00.000Z');
    expect(finDia('2026-09-24')).toBe('2026-09-25T05:00:00.000Z');
  });
});

describe('selección reconstruida desde la auditoría', () => {
  const dia = '2026-09-23';
  const corte = '2026-09-23T23:00:00Z';
  it('vale el último valor antes del corte', () => {
    const ev = [
      { requerimiento_id: 'a', valor: dia, at: '2026-09-23T14:00:00Z' }, // seleccionada
      { requerimiento_id: 'b', valor: dia, at: '2026-09-23T14:00:00Z' },
      { requerimiento_id: 'b', valor: null, at: '2026-09-23T16:00:00Z' }, // quitada
      { requerimiento_id: 'c', valor: dia, at: '2026-09-23T14:00:00Z' },
      { requerimiento_id: 'c', valor: null, at: '2026-09-24T14:00:00Z' }, // quitada después del corte
      { requerimiento_id: 'd', valor: '2026-09-22', at: '2026-09-22T14:00:00Z' }, // era de ayer
    ];
    const sel = reconstruirSeleccion(dia, corte, ev, [
      { id: 'e', daily_fecha: dia },
      { id: 'f', daily_fecha: null },
    ]);
    expect([...sel].sort()).toEqual(['a', 'c', 'e']);
  });
});

describe('métricas del día', () => {
  it('plan vs cerradas, fuera del daily, nuevas y vencidas', () => {
    const dia = '2026-09-23';
    const tareas = [
      t({ id: 'p1', completado_at: '2026-09-23T20:00:00Z' }), // planificada y cerrada
      t({ id: 'p2', owner_agencia: ['beto'], fecha_entrega: '2026-09-23' }), // planificada para entregar hoy, abierta
      t({ id: 'f1', completado_at: '2026-09-23T16:00:00Z', owner_agencia: ['beto'] }), // cerrada fuera del daily
      t({ id: 'n1', created_at: '2026-09-23T15:00:00Z', planificacion: 'urgente' }), // nueva urgente
      t({ id: 'v1', fecha_entrega: '2026-09-20' }), // vencida abierta
      t({ id: 'v2', fecha_entrega: '2026-09-20', completado_at: '2026-09-24T15:00:00Z' }), // vencida ese día (se cerró después)
      t({ id: 'h1', fecha_entrega: '2026-05-01', estado_operativo: 'completado' }), // histórico importado: no es vencida
      t({ id: 'i1', created_at: '2026-09-23T15:00:00Z', fecha_pedido: '2026-03-02' }), // importada hoy, pedida en marzo: no es nueva
    ];
    const { metricas, por_persona } = metricasDia({
      dia,
      seleccion: new Set(['p1', 'p2']),
      tareas,
      reprocesos: [{ requerimiento_id: 'p2', abierto_at: '2026-09-23T18:00:00Z' }],
      reprogramaciones: [],
      bloqueos: 0,
      nombres: new Map([
        ['ana', 'Ana'],
        ['beto', 'Beto'],
      ]),
    });
    expect(metricas).toMatchObject({
      planificadas: 2,
      cerradas_planificadas: 1,
      cumplimiento_pct: 50,
      cerradas_fuera: 1,
      cerradas_total: 2,
      nuevas_hoy: 1,
      nuevas_urgentes: 1,
      reprocesos_hoy: 1,
      vencidas_abiertas: 2,
    });
    expect(por_persona.find((p) => p.nombre === 'Beto')).toMatchObject({ planificadas: 1, cerradas: 0, fuera: 1 });
    expect(
      resumir([
        { metricas, publicado: true },
        { metricas, publicado: false },
      ]),
    ).toMatchObject({ planificadas: 4, cerradas_planificadas: 2, cumplimiento_pct: 50, dias_con_cierre: 1 });
  });
});

describe('métricas del día: tareas de varios días (pedido de Carolina, 27/11)', () => {
  it('lo que se entrega otro día queda «en curso», no cuenta como incumplido, y se marca si tuvo avance', () => {
    const dia = '2026-11-24'; // lunes
    const fer = { owner_agencia: ['fer'] };
    const tareas = [
      t({ id: 'g1', ...fer, fecha_entrega: '2026-11-26' }), // guion, se entrega el miércoles; tuvo horas hoy
      t({ id: 'g2', ...fer, fecha_entrega: '2026-11-27' }), // gráfica con revisiones; sin señales hoy
      t({ id: 'h1', ...fer, fecha_entrega: '2026-11-24' }), // vencía hoy y no se cerró
      t({ id: 'h2', ...fer, fecha_entrega: '2026-11-24', completado_at: '2026-11-24T20:00:00Z' }), // vencía hoy y se cerró
      t({ id: 'a1', ...fer, fecha_entrega: '2026-11-28', completado_at: '2026-11-24T21:00:00Z' }), // se adelantó: cuenta
    ];
    const { metricas, por_persona } = metricasDia({
      dia,
      seleccion: new Set(['g1', 'g2', 'h1', 'h2', 'a1']),
      tareas,
      reprocesos: [],
      reprogramaciones: [],
      bloqueos: 0,
      nombres: new Map([['fer', 'Fernando']]),
      avance: new Set(['g1']),
    });
    expect(metricas).toMatchObject({
      planificadas: 5,
      para_hoy: 3,
      en_curso: 2,
      en_curso_con_avance: 1,
      cerradas_planificadas: 2,
      cumplimiento_pct: 67,
    });
    expect(por_persona[0]).toMatchObject({ nombre: 'Fernando', planificadas: 5, para_hoy: 3, en_curso: 2, con_avance: 1, cerradas: 2 });
  });

  it('una tarea que se cerró ese día y después se reabrió (ajustes) sigue contando como cerrada ese día', () => {
    const tareas = [t({ id: 'r1', owner_agencia: ['fer'], fecha_entrega: '2026-11-23', completado_at: '2026-11-26T22:00:00Z' })];
    const base = {
      dia: '2026-11-23',
      seleccion: new Set(['r1']),
      tareas,
      reprocesos: [],
      reprogramaciones: [],
      bloqueos: 0,
      nombres: new Map([['fer', 'Persona']]),
    };
    expect(metricasDia(base).metricas.cerradas_planificadas).toBe(0);
    expect(metricasDia({ ...base, cierres: new Set(['r1']) }).metricas).toMatchObject({ cerradas_planificadas: 1, cumplimiento_pct: 100 });
  });

  it('el resumen del mes mide sobre lo que se entregaba cada día', () => {
    const m = (para_hoy: number, cerradas: number, planificadas: number) =>
      ({ planificadas, para_hoy, cerradas_planificadas: cerradas }) as unknown as Parameters<typeof resumir>[0][number]['metricas'];
    expect(
      resumir([
        { metricas: m(2, 2, 10), publicado: true },
        { metricas: m(2, 1, 4), publicado: true },
      ]),
    ).toMatchObject({
      planificadas: 4,
      cumplimiento_pct: 75,
    });
  });
});

describe('métricas de la semana', () => {
  it('a tiempo original y vigente, arrastre, plan y acuerdos', () => {
    const tareas = [
      t({ id: 'a', fecha_entrega_original: '2026-09-23', fecha_entrega: '2026-09-23', completado_at: '2026-09-23T20:00:00Z' }), // a tiempo
      t({ id: 'b', fecha_entrega_original: '2026-09-22', fecha_entrega: '2026-09-25', completado_at: '2026-09-25T15:00:00Z' }), // solo vigente
      t({ id: 'c', fecha_entrega_original: '2026-09-24', fecha_entrega: '2026-09-30' }), // arrastre
    ];
    const m = metricasSemana({
      inicio: '2026-09-21',
      fin: '2026-09-27',
      tareas,
      reprocesos: [],
      reprogramaciones: [{ requerimiento_id: 'b', created_at: '2026-09-22T15:00:00Z', motivo: 'insumos_cliente' }],
      senales: [{ severidad: 'critica', atendida: true }],
      acuerdos: [
        { estado: 'cumplido', fecha_compromiso: '2026-09-24', cerrado_at: '2026-09-24T20:00:00Z' },
        { estado: 'pendiente', fecha_compromiso: '2026-09-25', cerrado_at: null },
      ],
      planIds: ['a', 'c'],
      dailies: { apertura: 4, cierre: 3 },
    });
    expect(m).toMatchObject({
      comprometidas: 3,
      a_tiempo_original: 1,
      a_tiempo_vigente: 2,
      arrastre: 1,
      cerradas: 2,
      plan_tareas: 2,
      plan_cumplidas: 1,
      pct_plan: 50,
      reprogramaciones_cliente: 1,
      senales_criticas: 1,
      acuerdos: 2,
      acuerdos_a_tiempo: 1,
      dias_habiles: 5,
    });
  });
});
