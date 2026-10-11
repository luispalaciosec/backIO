import { describe, expect, it } from 'vitest';
import type { KpiDefinicion } from '@backio/shared';
import { cerradaATiempo } from '@backio/shared';
import { aTiempoOriginal, resumirCumplimiento } from '../lib/cumplimiento';
import { metricasSemana, type TareaEvo } from '../lib/evolutivo';
import { calcular, rangoPeriodo } from '../lib/kpis';
import type { DatosKpi, ReqKpi } from '../lib/db/kpis';

// Ola 8 (B4): «a tiempo» debe dar lo mismo en cumplimiento, dashboard, personas, informes (resumirCumplimiento),
// evolutivo y KPIs. Caso límite: vence el 08/10 y se cierra a las 19:30 de Guayaquil (00:30 UTC del 09/10).
const VENCE = '2026-10-08';
const NOCHE = '2026-10-09T00:30:00Z'; // 19:30 del 08 en Guayaquil: a tiempo
const MADRUGADA = '2026-10-09T05:30:00Z'; // 00:30 del 09 en Guayaquil: tarde

const evo = (completado_at: string): TareaEvo => ({
  id: completado_at,
  owner_agencia: ['ana'],
  estado_operativo: 'completado',
  completado_at,
  created_at: '2026-10-01T15:00:00Z',
  planificacion: 'planificado',
  fecha_entrega: VENCE,
  fecha_entrega_original: VENCE,
  daily_fecha: null,
});
const kpiReq = (completado_at: string) =>
  ({
    id: completado_at,
    titulo_interno: 't',
    cliente_id: 'c',
    proyecto_id: null,
    owner_agencia: ['ana'],
    prioridad: 'media',
    estado_operativo: 'completado',
    estado_aprobacion: 'no_aplica',
    fecha_entrega: VENCE,
    fecha_entrega_original: VENCE,
    completado_at,
    created_at: '2026-10-01T15:00:00Z',
    clase: 'tarea',
    proactiva: false,
    primera_respuesta_at: null,
    basecamp_url: null,
  }) as ReqKpi;
const defATiempo = {
  id: 'k',
  codigo: 'K',
  operador: '>=',
  meta: 0.9,
  tipo: 'porcentaje',
  calculo: 'a_tiempo',
  activo: true,
} as KpiDefinicion;
const datos = (completadas: ReqKpi[]) =>
  ({
    completadas,
    creadas: [],
    decididas: [],
    reprocesos: [],
    reprogramaciones: [],
    eventos: [],
    ejecutivaProyecto: new Map(),
    clientes: new Map(),
  }) as DatosKpi;

describe('una sola definición de «a tiempo»', () => {
  for (const [nombre, cierre, esperado] of [
    ['cierre a las 19:30 del día de entrega', NOCHE, true],
    ['cierre a las 00:30 del día siguiente', MADRUGADA, false],
  ] as const) {
    it(`${nombre}: todos los módulos dicen ${esperado ? 'a tiempo' : 'tarde'}`, () => {
      const r = { completado_at: cierre, fecha_entrega_original: VENCE, fecha_entrega: VENCE };
      const pct = esperado ? 100 : 0;
      expect(cerradaATiempo(cierre, VENCE)).toBe(esperado);
      expect(aTiempoOriginal(r)).toBe(esperado);
      expect(resumirCumplimiento([{ ...r, id: 'r1' } as never], [], []).pct_original).toBe(pct);
      const sem = metricasSemana({
        inicio: '2026-10-05',
        fin: '2026-10-11',
        tareas: [evo(cierre)],
        reprocesos: [],
        reprogramaciones: [],
        senales: [],
        acuerdos: [],
        planIds: null,
        dailies: { apertura: 0, cierre: 0 },
      });
      expect(sem.a_tiempo_original).toBe(esperado ? 1 : 0);
      expect(calcular(defATiempo, datos([kpiReq(cierre)]), rangoPeriodo('2026-10')).items.map((i) => i.a)).toEqual([esperado]);
    });
  }
});
