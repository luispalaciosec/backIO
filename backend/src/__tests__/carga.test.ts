import { describe, expect, it } from 'vitest';
import type { RequerimientoMetricas, Usuario } from '@backio/shared';
import {
  agruparHoras,
  calcularCarga,
  crearCapacidades,
  crearEstimador,
  type Capacidades,
  cuentaEnLaCarga,
  diaCorto,
  diasHabilesRestantes,
  textoRiesgo,
  HORAS_SIN_DATOS,
  type MuestraHoras,
} from '../lib/carga';
import { calcularSenales } from '../lib/rituals/signals';

const r = (p: Partial<RequerimientoMetricas>) =>
  ({
    id: Math.random().toString(36).slice(2),
    cliente_id: 'c',
    proyecto_id: null,
    titulo_interno: 'Tarea',
    tipo_pieza_id: null,
    owner_agencia: ['oscar'],
    fecha_entrega: '2026-11-04',
    estado_operativo: 'en_ejecucion',
    estado_aprobacion: 'no_aplica',
    dias_atraso: 0,
    dias_sin_movimiento: 0,
    ...p,
  }) as RequerimientoMetricas;
const u = (id: string, capacidad_semanal = 40) => ({ id, nombre: id, activo: true, capacidad_semanal }) as Usuario;
const muestras = (usuario_id: string, horas: number[], tipo_pieza_id: string | null = null): MuestraHoras[] =>
  horas.map((h) => ({ usuario_id, tipo_pieza_id, horas: h }));

const semana = { fecha_inicio: '2026-11-02', fecha_fin: '2026-11-08' };
const declarada: Capacidades = (x) => ({ horas: x.capacidad_semanal, base: 'declarada' });

// docs/05 · Riesgo de la semana (Fase 3 de las mejoras, 30/10/2026).
describe('Estimación de horas por tarea', () => {
  const base = [...muestras('oscar', [6, 6, 6, 6, 6]), ...muestras('ana', [2, 2, 2])];

  it('usa la mediana de la persona con 5 tareas o más; si no, la general', () => {
    const est = crearEstimador(base, []);
    expect(est('oscar', null)).toEqual({ horas: 6, base: 'persona' });
    expect(est('ana', null)).toEqual({ horas: 6, base: 'general' });
  });

  it('el tipo de pieza manda si tiene datos; si no, su esfuerzo × la mediana general', () => {
    const conTipo = [...base, ...muestras('ana', [10, 10, 10, 10, 10], 'reel')];
    expect(crearEstimador(conTipo, [])('oscar', 'reel')).toEqual({ horas: 10, base: 'tipo' });
    expect(crearEstimador(base, [{ id: 'carrusel', esfuerzo: 1.5 }])('ana', 'carrusel')).toEqual({ horas: 9, base: 'esfuerzo' });
  });

  it('sin datos asume 4 h, como antes', () => {
    expect(crearEstimador(muestras('oscar', [1, 2]), [])('oscar', null)).toEqual({ horas: HORAS_SIN_DATOS, base: 'fijo' });
  });

  it('separa lo completado (muestras) de lo ya registrado en tareas abiertas, por persona', () => {
    const { muestras: m, registradas } = agruparHoras([
      {
        usuario_id: 'oscar',
        requerimiento_id: 'a',
        fecha: '2026-10-20',
        horas: 2,
        requerimientos: { estado_operativo: 'completado', tipo_pieza_id: null },
      },
      {
        usuario_id: 'oscar',
        requerimiento_id: 'a',
        fecha: '2026-10-20',
        horas: 1.5,
        requerimientos: { estado_operativo: 'completado', tipo_pieza_id: null },
      },
      {
        usuario_id: 'oscar',
        requerimiento_id: 'b',
        fecha: '2026-10-20',
        horas: 3,
        requerimientos: { estado_operativo: 'en_ejecucion', tipo_pieza_id: null },
      },
      {
        usuario_id: null,
        requerimiento_id: 'c',
        fecha: '2026-10-20',
        horas: 9,
        requerimientos: { estado_operativo: 'completado', tipo_pieza_id: null },
      },
    ]);
    expect(m).toEqual([{ usuario_id: 'oscar', tipo_pieza_id: null, horas: 3.5 }]);
    expect(registradas.get('oscar|b')).toBe(3);
  });
});

describe('Capacidad en horas de timesheet', () => {
  // Una fila por semana: lunes 7/9 a lunes 19/10 (7 semanas antes del 2/11), más una de esta semana que no cuenta.
  const lunes = ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'];
  const filas = [
    ...lunes.map((fecha, i) => ({ usuario_id: 'hector', fecha, horas: 10 + i * 5 })), // 10…40
    ...lunes.slice(0, 3).map((fecha) => ({ usuario_id: 'oscar', fecha, horas: 50 })), // pocas semanas
    { usuario_id: 'hector', fecha: '2026-11-02', horas: 99 },
  ];
  const cap = crearCapacidades(filas, '2026-11-02');

  it('usa el percentil 75 de las semanas con horas de la persona', () => {
    expect(cap(u('hector'))).toEqual({ horas: 35, base: 'ritmo' });
  });
  it('con menos de 6 semanas usa la del equipo; sin datos de nadie, la declarada', () => {
    expect(cap(u('oscar'))).toEqual({ horas: 35, base: 'equipo' });
    expect(crearCapacidades([], '2026-11-02')(u('oscar', 40))).toEqual({ horas: 40, base: 'declarada' });
  });
});

describe('Carga de la semana', () => {
  it('cuenta los días hábiles que quedan desde hoy', () => {
    expect(diasHabilesRestantes('2026-10-31', semana)).toBe(5); // la semana no empezó
    expect(diasHabilesRestantes('2026-11-02', semana)).toBe(5);
    expect(diasHabilesRestantes('2026-11-05', semana)).toBe(2); // jueves y viernes
    expect(diasHabilesRestantes('2026-11-07', semana)).toBe(0); // sábado
  });

  it('entra lo que vence hasta el domingo; no lo que espera al cliente ni lo atrasado quieto', () => {
    const hoy = '2026-11-02';
    expect(cuentaEnLaCarga(r({ fecha_entrega: '2026-11-08' }), hoy, semana.fecha_fin)).toBe(true);
    expect(cuentaEnLaCarga(r({ fecha_entrega: '2026-11-09' }), hoy, semana.fecha_fin)).toBe(false);
    expect(cuentaEnLaCarga(r({ estado_aprobacion: 'pendiente_cliente' }), hoy, semana.fecha_fin)).toBe(false);
    expect(cuentaEnLaCarga(r({ fecha_entrega: '2026-10-28', dias_sin_movimiento: 2 }), hoy, semana.fecha_fin)).toBe(true);
    expect(cuentaEnLaCarga(r({ fecha_entrega: '2026-10-20', dias_sin_movimiento: 12 }), hoy, semana.fecha_fin)).toBe(false);
  });

  it('lo que no entra en la capacidad que queda, por fecha, queda en riesgo; resta lo ya registrado', () => {
    const tareas = [
      r({ id: 't1', fecha_entrega: '2026-11-03' }),
      r({ id: 't2', fecha_entrega: '2026-11-04' }),
      r({ id: 't3', fecha_entrega: '2026-11-06' }),
      r({ id: 't4', fecha_entrega: '2026-11-06', owner_agencia: ['oscar', 'ana'] }),
    ];
    const [c] = calcularCarga({
      activos: tareas,
      usuarios: [u('oscar', 10), u('inactivo')].map((x, i) => (i ? { ...x, activo: false } : x)),
      semana,
      hoy: '2026-11-05', // quedan 2 días: 10 h × 2/5 = 4 h
      estimar: () => ({ horas: 2, base: 'persona' }),
      capacidades: declarada,
      registradas: new Map([['oscar|t1', 1.5]]),
    });
    expect(c!.capacidad_restante).toBe(4);
    expect(c!.tareas.map((t) => t.horas)).toEqual([0.5, 2, 2, 2]); // t1: 2 − 1,5
    expect(c!.horas).toBe(6.5);
    expect(c!.exceso).toBe(2.5);
    expect(c!.en_riesgo.map((t) => t.id)).toEqual(['t3', 't4']);
  });

  it('sin días hábiles por delante no marca riesgo', () => {
    const [c] = calcularCarga({
      activos: [r({ fecha_entrega: '2026-11-08' })],
      usuarios: [u('oscar')],
      semana,
      hoy: '2026-11-07',
      estimar: () => ({ horas: 50, base: 'persona' }),
      capacidades: declarada,
      registradas: new Map(),
    });
    expect(c!.en_riesgo).toEqual([]);
    expect(c!.exceso).toBe(0);
  });

  it('la señal de sobrecarga usa las horas estimadas cuando las hay', () => {
    const [carga] = calcularCarga({
      activos: [r({ id: 'x', fecha_entrega: '2026-11-03' }), r({ id: 'y', fecha_entrega: '2026-11-04' })],
      usuarios: [u('oscar', 5)],
      semana,
      hoy: '2026-11-02',
      estimar: () => ({ horas: 3, base: 'persona' }),
      capacidades: declarada,
      registradas: new Map(),
    });
    const senales = calcularSenales({
      hoy: '2026-11-02',
      semana,
      activos: [],
      completadosRecientes: [],
      usuarios: [u('oscar', 5)],
      clientes: [],
      acuerdosAbiertos: [],
      carga: [carga!],
    }).filter((s) => s.tipo === 'sobrecarga_proyectada');
    expect(senales).toHaveLength(1);
    expect(senales[0]!.titulo).toBe('oscar: ~6h estimadas sobre 5h disponibles esta semana (1 en riesgo)');
    expect(senales[0]!.detalle.en_riesgo).toEqual(['y']);
  });

  it('el aviso del lunes lista las tareas con su responsable y sus horas', () => {
    const persona = { usuario_id: 'oscar', nombre: 'Oscar', horas: 52, capacidad_restante: 40 } as never;
    const tarea = {
      id: 't',
      titulo: 'Reel Halloween',
      cliente_id: 'c',
      proyecto_id: null,
      fecha_entrega: '2026-11-03',
      horas: 4,
      base: 'persona' as const,
    };
    const t = textoRiesgo([{ tarea, persona }], () => 'Foligain');
    expect(diaCorto('2026-11-03')).toBe('mar 3/11');
    expect(t.titulo).toBe('1 tarea en riesgo esta semana');
    expect(t.cuerpo).toContain('• Reel Halloween (Foligain): vence el mar 3/11; Oscar tiene ~52 h para 40 h disponibles.');
  });
});
