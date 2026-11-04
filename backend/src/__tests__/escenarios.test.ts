import { describe, expect, it } from 'vitest';
import type { RequerimientoMetricas, Salud } from '@backio/shared';
import { calcularEscenarios, type IdEscenario } from '../lib/rituals/escenarios';

const hoy = '2026-11-04';
const r = (id: string, p: Partial<RequerimientoMetricas> = {}) =>
  ({
    id,
    cliente_id: 'c1',
    owner_agencia: ['ana'],
    fecha_entrega: '2026-11-06',
    estado_operativo: 'priorizado',
    estado_aprobacion: 'no_aplica',
    dias_atraso: 0,
    dias_sin_movimiento: 0,
    daily_fecha: null,
    planificacion: 'planificado',
    ...p,
  }) as RequerimientoMetricas;
const calc = (
  activos: RequerimientoMetricas[],
  o: { cap?: number; salud?: [string, Salud][]; horas?: number; otras?: number; solo?: string[] } = {},
) => {
  const horas: Record<string, Record<string, number>> = {};
  for (const x of activos) for (const u of x.owner_agencia) (horas[x.id] ??= {})[u] = o.horas ?? 2;
  return calcularEscenarios({
    activos,
    hoy,
    carga: { horas, capacidad_dia: { ana: o.cap ?? 5, beto: 5 }, otras_mesas: o.otras ? { ana: o.otras } : {} },
    salud: new Map(o.salud ?? []),
    soloIds: o.solo ? new Set(o.solo) : undefined,
  });
};
const de = (d: ReturnType<typeof calc>, id: IdEscenario) => d.escenarios.find((e) => e.id === id);

// docs/05 · Escenarios para armar el día (4/11/2026).
describe('escenarios del día', () => {
  it('nunca sugiere lo que espera al cliente, lo bloqueado, lo que no tiene responsable ni lo atrasado y quieto', () => {
    const d = calc([
      r('ok', { fecha_entrega: hoy }),
      r('cliente', { fecha_entrega: hoy, estado_aprobacion: 'pendiente_cliente' }),
      r('bloq', { fecha_entrega: hoy, estado_operativo: 'bloqueado' }),
      r('sin', { fecha_entrega: hoy, owner_agencia: [] }),
      r('quieta', { fecha_entrega: '2026-09-01', dias_atraso: 60, dias_sin_movimiento: 30 }),
    ]);
    for (const e of d.escenarios) expect(e.tareas.map((t) => t.id)).toEqual(['ok']);
    expect(d.sigue_viva.map((x) => x.id)).toEqual(['quieta']);
  });
  it('lo atrasado que se movió en la última semana sí se sugiere', () => {
    const d = calc([r('viva', { fecha_entrega: '2026-11-01', dias_atraso: 3, dias_sin_movimiento: 2 })]);
    expect(de(d, 'sin_vencidos')?.tareas[0]).toEqual({ id: 'viva', razones: ['atrasada'] });
  });
  it('respeta las horas del día de cada persona y cuenta lo que queda afuera', () => {
    const d = calc([r('a', { fecha_entrega: hoy }), r('b', { fecha_entrega: hoy }), r('c', { fecha_entrega: hoy })], { cap: 4 });
    const i = de(d, 'sin_vencidos')!.impacto;
    expect(i.tareas).toBe(2);
    expect(i.afuera).toBe(1);
    expect(i.vencen_hoy_cubiertas).toBe(2);
    expect(i.vencen_hoy).toBe(3);
    expect(i.personas).toEqual([{ usuario_id: 'ana', horas: 4, capacidad: 4 }]);
  });
  it('la primera tarea de alguien entra aunque sola pase del día; lo elegido en otras mesas ya cuenta', () => {
    expect(calc([r('larga', { fecha_entrega: hoy })], { cap: 4, horas: 6 }).escenarios[0]!.impacto.tareas).toBe(1);
    expect(calc([r('a', { fecha_entrega: hoy })], { cap: 5, otras: 4 }).escenarios[0]!.impacto.afuera).toBe(1);
  });
  it('lo ya elegido hoy se mantiene y no cuenta como nuevo', () => {
    const d = calc([r('ya', { daily_fecha: hoy, estado_aprobacion: 'pendiente_cliente' }), r('b', { fecha_entrega: hoy })]);
    const e = de(d, 'sin_vencidos')!;
    expect(e.tareas.map((t) => t.id)).toEqual(['ya', 'b']);
    expect(e.tareas[0]!.razones).toContain('ya_elegida');
    expect(e.impacto.nuevas).toBe(1);
  });
  it('más entregas prefiere lo corto en curso; cuentas en riesgo, los clientes en rojo y amarillo', () => {
    const activos = [
      r('larga', { fecha_entrega: hoy, cliente_id: 'verde' }),
      r('corta', { estado_operativo: 'en_ejecucion', cliente_id: 'rojo' }),
      r('amar', { cliente_id: 'amarillo' }),
    ];
    const d = calcularEscenarios({
      activos,
      hoy,
      carga: { horas: { larga: { ana: 4 }, corta: { ana: 1 }, amar: { ana: 1 } }, capacidad_dia: { ana: 5 }, otras_mesas: {} },
      salud: new Map<string, Salud>([
        ['rojo', 'rojo'],
        ['amarillo', 'amarillo'],
      ]),
    });
    expect(de(d, 'mas_entregas')!.tareas[0]!.id).toBe('corta');
    expect(de(d, 'cuentas_riesgo')!.tareas.map((t) => t.id)).toEqual(['corta', 'amar']);
  });
  it('recomienda por regla: vencidos, luego cuentas en rojo, luego más entregas', () => {
    const rec = (d: ReturnType<typeof calc>) => d.escenarios.find((e) => e.recomendado)?.id;
    expect(rec(calc([r('a', { fecha_entrega: hoy })]))).toBe('sin_vencidos');
    expect(rec(calc([r('a'), r('b', { cliente_id: 'c2' })], { salud: [['c2', 'rojo']] }))).toBe('cuentas_riesgo');
    const d = calc([r('a')]);
    expect(rec(d)).toBe('mas_entregas');
    expect(d.porque).toContain('No hay vencidos ni cuentas en rojo');
  });
  it('escenarios con las mismas tareas no se repiten; el recomendado queda adelante', () => {
    const d = calc([r('a', { fecha_entrega: hoy })], { salud: [['c1', 'rojo']] });
    expect(d.escenarios).toHaveLength(1);
    expect(d.escenarios[0]!.recomendado).toBe(true);
  });
  it('«solo mis cuentas» limita lo sugerido, no la carga de las personas', () => {
    const d = calc([r('mia', { fecha_entrega: hoy }), r('otra', { fecha_entrega: hoy, daily_fecha: hoy })], { solo: ['mia'], cap: 2 });
    const e = d.escenarios[0]!;
    expect(e.tareas.map((t) => t.id)).toEqual(['otra']); // la ya elegida ocupa sus 2 h: la mía no entra
    expect(e.impacto.afuera).toBe(1);
  });

  // Del weekly al daily: lo que se acordó sobre una tarea sale primero, con su razón a la vista.
  it('una tarea con compromiso del weekly va primero, aunque esté quieta o venza lejos', () => {
    const quieta = r('quieta', { fecha_entrega: '2026-10-01', dias_atraso: 30, dias_sin_movimiento: 30 });
    const lejos = r('lejos', { fecha_entrega: '2026-12-20' });
    const otra = r('otra', { fecha_entrega: hoy });
    const d = calcularEscenarios({
      activos: [otra, quieta, lejos],
      hoy,
      carga: { horas: {}, capacidad_dia: { [otra.owner_agencia[0]!]: 8 }, otras_mesas: {} },
      salud: new Map(),
      compromisos: new Set(['quieta', 'lejos']),
    });
    const sinVencidos = d.escenarios.find((e) => e.id === 'sin_vencidos')!;
    expect(
      sinVencidos.tareas
        .slice(0, 2)
        .map((t) => t.id)
        .sort(),
    ).toEqual(['lejos', 'quieta']);
    expect(sinVencidos.tareas.find((t) => t.id === 'quieta')?.razones).toContain('compromiso_weekly');
    expect(d.sigue_viva.map((x) => x.id)).not.toContain('quieta');
  });
  it('un compromiso no saca a una tarea bloqueada o que espera al cliente', () => {
    const b = r('b', { estado_operativo: 'bloqueado' });
    const c = r('c', { estado_aprobacion: 'pendiente_cliente' });
    const d = calcularEscenarios({
      activos: [b, c],
      hoy,
      carga: { horas: {}, capacidad_dia: { [b.owner_agencia[0]!]: 8 }, otras_mesas: {} },
      salud: new Map(),
      compromisos: new Set(['b', 'c']),
    });
    expect(d.escenarios).toEqual([]);
  });
});
