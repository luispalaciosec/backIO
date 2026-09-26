import { describe, it, expect } from 'vitest';
import type { KpiDefinicion, Reproceso, Reprogramacion } from '@backio/shared';
import { minutosHabiles, dentroSla } from '../lib/horas_habiles';
import { rangoPeriodo, periodosAnteriores, trimestreDe, calcular, resolverKpi, estadoDe, FEATURES_DESDE } from '../lib/kpis';
import type { DatosKpi, ReqKpi } from '../lib/db/kpis';
import { marcasDeTitulo } from '../lib/basecamp/importar';

const def = (p: Partial<KpiDefinicion>): KpiDefinicion => ({
  id: 'k1', tenant_id: 't', codigo: 'KPI-X', area: 'diseno', indicador: 'x', periodicidad: 'mensual', operador: '>=', meta: 0.9,
  tipo: 'porcentaje', numerador_label: 'a', denominador_label: 'b', denominador_fijo: null, calculo: 'a_tiempo',
  fuente: null, regla: null, formula: null, activo: true, orden: 0, ...p,
});
const req = (p: Partial<ReqKpi>): ReqKpi => ({
  id: Math.random().toString(36).slice(2), titulo_interno: 't', cliente_id: 'c', proyecto_id: null, owner_agencia: ['ana'], prioridad: 'media',
  estado_operativo: 'completado', estado_aprobacion: 'no_aplica', fecha_entrega: '2026-10-10', fecha_entrega_original: '2026-10-10',
  completado_at: '2026-10-10T15:00:00.000Z', created_at: '2026-10-01T15:00:00.000Z', clase: 'tarea', proactiva: false, primera_respuesta_at: null, basecamp_url: null, ...p,
});
const datos = (p: Partial<DatosKpi>): DatosKpi => ({ completadas: [], creadas: [], decididas: [], reprocesos: [], reprogramaciones: [], eventos: [], ejecutivaProyecto: new Map(), clientes: new Map(), ...p });
const oct = rangoPeriodo('2026-10');

describe('horas hábiles (L-V 09:00–18:00 Guayaquil)', () => {
  it('viernes 17:30 → lunes 09:20 son 50 minutos', () => {
    // Viernes 2 oct 2026 17:30 GYE = 22:30Z · lunes 5 oct 09:20 GYE = 14:20Z
    expect(minutosHabiles(new Date('2026-10-02T22:30:00Z'), new Date('2026-10-05T14:20:00Z'))).toBe(50);
  });
  it('fuera de horario y fin de semana no cuentan', () => {
    expect(minutosHabiles(new Date('2026-10-03T15:00:00Z'), new Date('2026-10-04T20:00:00Z'))).toBe(0);
    expect(minutosHabiles(new Date('2026-10-05T12:00:00Z'), new Date('2026-10-05T14:30:00Z'))).toBe(30);
  });
  it('SLA por prioridad', () => {
    expect(dentroSla('alta', '2026-10-05T14:00:00Z', '2026-10-05T14:30:00Z')).toBe(true);
    expect(dentroSla('alta', '2026-10-05T14:00:00Z', '2026-10-05T14:31:00Z')).toBe(false);
    expect(dentroSla('baja', '2026-10-05T14:00:00Z', null)).toBeNull();
  });
});

describe('periodos', () => {
  it('rango de mes y trimestre en hora Guayaquil', () => {
    expect(rangoPeriodo('2026-10')).toEqual({ desde: '2026-10-01T05:00:00.000Z', hasta: '2026-11-01T05:00:00.000Z' });
    expect(rangoPeriodo('2026-T4')).toEqual({ desde: '2026-10-01T05:00:00.000Z', hasta: '2027-01-01T05:00:00.000Z' });
    expect(trimestreDe('2026-09')).toBe('2026-T3');
    expect(periodosAnteriores('2026-02', 3)).toEqual(['2025-12', '2026-01', '2026-02']);
  });
});

describe('calculadores', () => {
  it('a tiempo: cuenta la fecha vigente solo si todas las reprogramaciones fueron del cliente', () => {
    const tarde = req({ id: 'r1', fecha_entrega_original: '2026-10-05', fecha_entrega: '2026-10-12', completado_at: '2026-10-11T15:00:00Z' });
    const tardeEquipo = req({ id: 'r2', fecha_entrega_original: '2026-10-05', fecha_entrega: '2026-10-12', completado_at: '2026-10-11T15:00:00Z' });
    // Entregada el 6 a las 20:00 GYE (7 en UTC): sigue siendo a tiempo contra el día 6.
    const noche = req({ id: 'r3', fecha_entrega_original: '2026-10-06', completado_at: '2026-10-07T01:00:00Z' });
    const rg = (id: string, motivo: Reprogramacion['motivo']) => ({ requerimiento_id: id, motivo } as Reprogramacion);
    const c = calcular(def({}), datos({ completadas: [tarde, tardeEquipo, noche], reprogramaciones: [rg('r1', 'insumos_cliente'), rg('r2', 'capacidad_equipo')] }), oct);
    expect(c.items.map((i) => [i.req.id, i.a])).toEqual([['r1', true], ['r2', false], ['r3', true]]);
  });
  it('retrabajo: solo reprocesos atribuibles al equipo y del área', () => {
    const r1 = req({ id: 'r1' }), r2 = req({ id: 'r2' }), r3 = req({ id: 'r3' });
    const rp = (id: string, p: Partial<Reproceso>) => ({ requerimiento_id: id, origen: 'cliente', motivo: 'error_ejecucion', ...p } as Reproceso);
    const d = datos({ completadas: [r1, r2, r3], reprocesos: [rp('r1', {}), rp('r2', { motivo: 'cambio_opinion_cliente' }), rp('r3', { atribuible: 'equipo', area_responsable: 'produccion' })] });
    expect(calcular(def({ calculo: 'retrabajo', operador: '<=' }), d, oct).items.map((i) => i.a)).toEqual([true, false, false]);
  });
  it('aprobación en 1ª revisión usa las rondas; sin eventos cae al proxy estimado', () => {
    const r1 = req({ id: 'r1' }), r2 = req({ id: 'r2' });
    const ev = (id: string, ronda: number) => ({ requerimiento_id: id, estado_a: 'aprobado', ronda, created_at: '2026-10-09T15:00:00Z' });
    const conRondas = calcular(def({ calculo: 'aprobacion_primera' }), datos({ decididas: [r1, r2], completadas: [r1, r2], eventos: [ev('r1', 1), ev('r2', 3)] }), oct);
    expect(conRondas.estimado).toBe(false);
    expect(conRondas.items.map((i) => i.a)).toEqual([true, false]);
    const proxy = calcular(def({ calculo: 'aprobacion_primera' }), datos({ completadas: [r1, r2], reprocesos: [{ requerimiento_id: 'r2', origen: 'cliente' } as Reproceso] }), oct);
    expect(proxy.estimado).toBe(true);
    expect(proxy.items.map((i) => i.a)).toEqual([true, false]);
  });
  it('los KPIs que dependen de datos nuevos no se calculan antes de la migración', () => {
    const agosto = rangoPeriodo('2026-08');
    expect(agosto.hasta <= FEATURES_DESDE).toBe(true);
    expect(calcular(def({ calculo: 'proactividad', denominador_fijo: 3 }), datos({}), agosto).sin_dato).toBe(true);
  });
});

describe('persona y equipo', () => {
  it('equipo = Σ A / Σ B con la tarea compartida contada una vez', () => {
    const comp = req({ id: 'r1', owner_agencia: ['ana', 'beto'] });
    const tarde = req({ id: 'r2', owner_agencia: ['beto'], fecha_entrega_original: '2026-10-01', fecha_entrega: '2026-10-01', completado_at: '2026-10-05T15:00:00Z' });
    const r = resolverKpi(def({}), '2026-10', datos({ completadas: [comp, tarde] }), [{ id: 'ana' }, { id: 'beto' }], [], false);
    expect(r.personas.get('ana')).toMatchObject({ dato_a: 1, dato_b: 1, estado: 'cumple' });
    expect(r.personas.get('beto')).toMatchObject({ dato_a: 1, dato_b: 2, estado: 'no_cumple' });
    expect(r.equipo).toMatchObject({ dato_a: 1, dato_b: 2 });
  });
  it('proactividad: meta por persona y meta × integrantes en el equipo', () => {
    const p = (o: string) => req({ proactiva: true, owner_agencia: [o], created_at: '2026-10-07T15:00:00Z', estado_operativo: 'priorizado', completado_at: null });
    const r = resolverKpi(def({ calculo: 'proactividad', denominador_fijo: 3, meta: 1 }), '2026-10', datos({ creadas: [p('ana'), p('ana'), p('ana'), p('beto')] }), [{ id: 'ana' }, { id: 'beto' }], [], false);
    expect(r.personas.get('ana')).toMatchObject({ dato_a: 3, dato_b: 3, estado: 'cumple' });
    expect(r.equipo).toMatchObject({ dato_a: 4, dato_b: 6, estado: 'no_cumple' });
  });
  it('cumplimiento con >= y <=, y meta cero', () => {
    expect(estadoDe(0.9, 0.9, '>=')).toBe('cumple');
    expect(estadoDe(0.15, 0.15, '<=')).toBe('cumple');
    expect(estadoDe(0, 0, '<=')).toBe('cumple');
    expect(estadoDe(0.01, 0, '<=')).toBe('no_cumple');
    expect(estadoDe(null, 0.9, '>=')).toBe('sin_dato');
  });
});

describe('convenciones de título', () => {
  it('detecta [PROPUESTA], [INCIDENCIA] y [PROACTIVA]', () => {
    expect(marcasDeTitulo('[PROACTIVA] [Propuesta] Idea Black Friday')).toEqual({ clase: 'propuesta', proactiva: true });
    expect(marcasDeTitulo('[incidencia] Link roto')).toEqual({ clase: 'incidencia' });
    expect(marcasDeTitulo('Post normal')).toBeNull();
  });
});
