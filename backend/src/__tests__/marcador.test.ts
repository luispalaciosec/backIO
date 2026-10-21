import { describe, expect, it } from 'vitest';
import {
  calcularMarcador,
  fechaCompromiso,
  inicioTrimestre,
  numeroIso,
  racha,
  reconocidos,
  renderMarcadorCierre,
  renderMarcadorPlan,
  resultadoSemana,
  type TareaMarcador,
} from '../lib/rituals/marcador';

// Semana 43 de 2026: lunes 19/10. Anteriores: 12/10 (42), 05/10 (41), 28/09 (40, del tercer trimestre).
const t = (fecha: string, extra: Partial<TareaMarcador> = {}): TareaMarcador => ({
  fecha_entrega: fecha,
  estado_operativo: 'completado',
  completado_at: `${fecha}T15:00:00Z`,
  owner_agencia: ['ana'],
  ...extra,
});
const pendiente = (fecha: string, extra: Partial<TareaMarcador> = {}) =>
  t(fecha, { estado_operativo: 'en_ejecucion', completado_at: null, ...extra });
const semana = (fecha: string, hechas: number, total: number, extra: Partial<TareaMarcador> = {}) => [
  ...Array.from({ length: hechas }, () => t(fecha, extra)),
  ...Array.from({ length: total - hechas }, () => pendiente(fecha, extra)),
];

describe('fechas del marcador', () => {
  it('semana ISO y trimestre', () => {
    expect(numeroIso('2026-10-19')).toBe(43);
    expect(numeroIso('2026-12-28')).toBe(53);
    expect(numeroIso('2025-12-29')).toBe(1);
    expect(inicioTrimestre('2026-10-19')).toBe('2026-10-01');
    expect(inicioTrimestre('2026-09-28')).toBe('2026-07-01');
  });
});

describe('resultado de la semana', () => {
  it('como el acta: las canceladas no cuentan', () => {
    const r = resultadoSemana([...semana('2026-10-14', 17, 24), t('2026-10-14', { estado_operativo: 'cancelado' })], '2026-10-12', null);
    expect(r).toMatchObject({ numero: 42, completadas: 17, vigentes: 24, pct: 71 });
  });
  it('en una semana pasada, lo que se cerró después no cambia su resultado', () => {
    const tarde = t('2026-10-14', { completado_at: '2026-10-21T15:00:00Z' });
    expect(resultadoSemana([t('2026-10-14'), tarde], '2026-10-12', '2026-10-18').completadas).toBe(1);
  });
});

// 21/10/2026, decisión de Luis: se mide contra la fecha original, salvo que el cliente la haya movido.
describe('fecha comprometida', () => {
  const rp = (created_at: string, fecha_nueva: string, motivo: string | null) => ({ created_at, fecha_nueva, motivo });
  const tarea = pendiente('2026-10-22', { fecha_entrega_original: '2026-10-15' });
  it('reprogramar por el equipo o sin motivo no la saca de su semana', () => {
    expect(fechaCompromiso(tarea, [rp('2026-10-16T10:00:00Z', '2026-10-22', 'capacidad_equipo')])).toBe('2026-10-15');
    expect(fechaCompromiso(tarea, [rp('2026-10-16T10:00:00Z', '2026-10-22', null)])).toBe('2026-10-15');
    expect(fechaCompromiso(tarea, [rp('2026-10-16T10:00:00Z', '2026-10-22', 'prioridad_negocio')])).toBe('2026-10-15');
  });
  it('si la movió el cliente, cuenta desde la fecha que fijó ese cambio (y no los cambios del equipo después)', () => {
    expect(
      fechaCompromiso(tarea, [
        rp('2026-10-14T10:00:00Z', '2026-10-20', 'insumos_cliente'),
        rp('2026-10-19T10:00:00Z', '2026-10-22', 'capacidad_equipo'),
      ]),
    ).toBe('2026-10-20');
  });
  it('en el marcador: la tarea pasada a otra semana por el equipo sigue contando como no cumplida en la suya', () => {
    const tareas = [
      ...semana('2026-10-14', 3, 3),
      {
        ...t('2026-10-21', { fecha_entrega_original: '2026-10-14', completado_at: '2026-10-21T15:00:00Z' }),
        fecha_compromiso: '2026-10-14',
      },
    ];
    expect(resultadoSemana(tareas, '2026-10-12', '2026-10-18')).toMatchObject({ completadas: 3, vigentes: 4, pct: 75 });
    expect(resultadoSemana(tareas, '2026-10-19', '2026-10-25').vigentes).toBe(0);
  });
});

describe('racha', () => {
  it('cuenta desde la última hacia atrás; una semana sin tareas no corta', () => {
    const s = (pct: number | null) => ({ inicio: '', numero: 0, completadas: 0, vigentes: 0, tarde: 0, pct });
    expect(racha([s(90), s(70), s(85), s(null), s(80)])).toBe(2);
    expect(racha([s(90), s(79)])).toBe(0);
  });
});

describe('reconocimiento', () => {
  it('todas a tiempo contra la fecha original y al menos 4; nunca nombra a quien no cumplió', () => {
    const tareas = [
      ...semana('2026-10-21', 4, 4, { owner_agencia: ['johanna'] }),
      ...semana('2026-10-21', 4, 5, { owner_agencia: ['grace'] }),
      ...semana('2026-10-21', 3, 3, { owner_agencia: ['andrea'] }),
      // Reprogramada: se cerró en su fecha nueva, pero tarde contra la original.
      ...semana('2026-10-21', 3, 3, { owner_agencia: ['carolina'] }),
      t('2026-10-21', { owner_agencia: ['carolina'], fecha_entrega_original: '2026-10-15' }),
    ];
    expect(reconocidos(tareas, '2026-10-19')).toEqual([{ usuario_id: 'johanna', a_tiempo: 4 }]);
  });
  it('una heredada cerrada tarde no le quita el reconocimiento a quien la recibió', () => {
    const tareas = [
      ...semana('2026-10-21', 4, 4, { owner_agencia: ['johanna'] }),
      t('2026-10-20', { owner_agencia: ['johanna'], heredada: true, completado_at: '2026-10-22T15:00:00Z' }),
    ];
    expect(reconocidos(tareas, '2026-10-19')).toEqual([{ usuario_id: 'johanna', a_tiempo: 4 }]);
  });
});

describe('marcador completo', () => {
  const historia = [
    ...semana('2026-09-30', 9, 10), // semana 40 (tercer trimestre): 90 %
    ...semana('2026-10-07', 6, 7), // semana 41: 86 %
    ...semana('2026-10-14', 17, 24), // semana 42: 71 %
  ];
  it('plan: compromiso, semana pasada, racha y mejor semana del trimestre (sin la semana 40)', () => {
    const m = calcularMarcador([...historia, ...semana('2026-10-21', 0, 22)], '2026-10-19', { cierre: false });
    // La racha de las semanas 40-41 empezó en el trimestre anterior y llegó a este: cuenta entera (2).
    expect(m).toMatchObject({ compromiso: 22, racha: 0, mejor_racha_trimestre: 2, record: null, reconocidos: [] });
    expect(m.anterior).toMatchObject({ numero: 42, pct: 71 });
    expect(m.mejor_trimestre).toMatchObject({ numero: 41, pct: 86 });
    const md = renderMarcadorPlan(m);
    expect(md).toContain('| Compromiso | **22 tareas** con entrega esta semana |');
    expect(md).toContain('| Semana pasada | 17 de 24 (71 %), bajo la meta |');
    expect(md).toContain('| Mejor semana del trimestre | 86 % (semana 41) |');
  });
  it('una semana da el mismo número en su cierre y como «semana pasada» del plan siguiente', () => {
    const s42 = [...semana('2026-10-14', 17, 24), t('2026-10-15', { completado_at: '2026-10-20T15:00:00Z' })];
    const cierre = calcularMarcador(s42, '2026-10-12', { cierre: true });
    const plan = calcularMarcador(s42, '2026-10-19', { cierre: false });
    expect(cierre.actual).toMatchObject({ completadas: 17, vigentes: 25 });
    expect(plan.anterior).toMatchObject({ completadas: 17, vigentes: 25 });
  });
  it('cierre: resultado, meta, diferencia, racha, récord y reconocimiento', () => {
    const actual = [
      ...semana('2026-10-21', 7, 7, { owner_agencia: ['johanna'] }),
      ...semana('2026-10-22', 12, 15, { owner_agencia: ['grace'] }),
    ];
    const m = calcularMarcador([...historia, ...actual], '2026-10-19', { cierre: true });
    expect(m.actual).toMatchObject({ completadas: 19, vigentes: 22, pct: 86 });
    expect(m).toMatchObject({ racha: 1, record: 'iguala' });
    const md = renderMarcadorCierre(m, 1, (id) => (id === 'johanna' ? 'Johanna' : id));
    expect(md).toContain('| Resultado | **19 de 22 completadas en la semana (86 %)**; 1 cancelada no cuenta |');
    expect(md).toContain('| Meta de la mesa | 80 %: **cumplida** |');
    expect(md).toContain('| Frente a la semana pasada | +15 puntos (71 % → 86 %) |');
    expect(md).toContain('| Racha | **1 semana** en la meta |');
    expect(md).toContain('| Récord | Iguala la mejor semana del trimestre (antes: 86 %, semana 41) |');
    expect(md).toContain('- Johanna: 7 de 7 a tiempo');
    expect(md).not.toContain('grace');
  });
  it('la mejor racha del trimestre nunca es menor que la racha actual', () => {
    const m = calcularMarcador(
      [...semana('2026-09-23', 9, 10), ...semana('2026-09-30', 9, 10), ...semana('2026-10-07', 9, 10)],
      '2026-10-12',
      {
        cierre: false,
      },
    );
    expect(m.racha).toBe(3);
    expect(m.mejor_racha_trimestre).toBe(3);
  });
  it('lo completado después del domingo se dice en el resultado (cuadra con el arrastre)', () => {
    const m = calcularMarcador([...semana('2026-10-21', 3, 4), t('2026-10-22', { completado_at: '2026-10-26T15:00:00Z' })], '2026-10-19', {
      cierre: true,
    });
    expect(renderMarcadorCierre(m, 0, (id) => id)).toContain(
      '**3 de 5 completadas en la semana (60 %)**; 1 se completó después del domingo',
    );
  });
  it('una completada sin fecha de cierre (histórica) cuenta como completada', () => {
    expect(resultadoSemana([t('2026-10-14', { completado_at: null })], '2026-10-12', '2026-10-18').completadas).toBe(1);
  });
  it('sin dos semanas previas en el trimestre no hay récord', () => {
    const m = calcularMarcador([...semana('2026-10-07', 1, 10), ...semana('2026-10-21', 9, 10)], '2026-10-19', { cierre: true });
    expect(m.record).toBeNull();
  });
  it('sin récord ni reconocimiento, esas líneas no salen', () => {
    const m = calcularMarcador([...historia, ...semana('2026-10-21', 1, 3)], '2026-10-19', { cierre: true });
    const md = renderMarcadorCierre(m, 0, (id) => id);
    expect(md).toContain('**no cumplida**');
    expect(md).not.toContain('Récord');
    expect(md).not.toContain('Reconocimiento');
  });
});
