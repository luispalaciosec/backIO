import { describe, expect, it } from 'vitest';
import type { KpiDefinicion } from '@backio/shared';
import { saludCliente, reprocesoDelEquipo } from '@backio/shared';
import { calcular, rangoPeriodo } from '../lib/kpis';
import type { DatosKpi, ReqKpi } from '../lib/db/kpis';
import { alcanceEjecutiva } from '../lib/db/mesas';
import { cuerpoDaily } from '../lib/mcp/publish';

// Migración 37: ejecutiva de cuenta por cliente (Grace lleva Torres & Torres, que produce Omega) y ficha del cliente.

/** Cliente de Supabase mínimo: cada consulta devuelve las filas de su tabla filtradas por los .eq(). */
function dbFalsa(tablas: Record<string, Record<string, unknown>[]>) {
  return {
    from(tabla: string) {
      const filtros: [string, unknown][] = [];
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (filtros.push([c, v]), q),
        is: (c: string, v: unknown) => (filtros.push([c, v]), q),
        then: (ok: (r: { data: unknown[]; error: null }) => void) =>
          ok({ data: (tablas[tabla] ?? []).filter((f) => filtros.every(([c, v]) => (f[c] ?? null) === v)), error: null }),
      };
      return q;
    },
  };
}

describe('Mis cuentas (alcanceEjecutiva)', () => {
  it('trae sus clientes de cualquier mesa, sin los de prueba, y los proyectos que tiene en clientes ajenos', async () => {
    const T = 't';
    const db = dbFalsa({
      clientes: [
        { id: 'tyt', tenant_id: T, ejecutiva_id: 'grace', mesa_id: 'omega', deleted_at: null, es_prueba: false },
        { id: 'abi', tenant_id: T, ejecutiva_id: 'grace', mesa_id: 'orion', deleted_at: null, es_prueba: false },
        { id: 'acme', tenant_id: T, ejecutiva_id: 'grace', mesa_id: 'omega', deleted_at: null, es_prueba: true },
        { id: 'banco', tenant_id: T, ejecutiva_id: 'carolina', mesa_id: 'omega', deleted_at: null, es_prueba: false },
      ],
      proyectos: [
        { id: 'p-banco', tenant_id: T, cliente_id: 'banco', owner_ejecutiva: 'grace', deleted_at: null },
        { id: 'p-banco-2', tenant_id: T, cliente_id: 'banco', owner_ejecutiva: null, deleted_at: null },
      ],
    });
    const ctx = { db, tenantId: T, usuarioId: null, origen: 'ui' } as never;
    expect(await alcanceEjecutiva(ctx, 'grace')).toEqual({ clienteIds: ['tyt', 'abi'], proyectoIds: ['p-banco'] });
  });
});

describe('KPIs de Cuentas: ejecutiva efectiva', () => {
  const def = {
    id: 'k',
    tenant_id: 't',
    codigo: 'K',
    area: 'cuentas',
    indicador: 'x',
    periodicidad: 'mensual',
    operador: '>=',
    meta: 0.9,
    tipo: 'porcentaje',
    numerador_label: 'a',
    denominador_label: 'b',
    denominador_fijo: null,
    calculo: 'a_tiempo',
    fuente: null,
    regla: null,
    formula: null,
    activo: true,
    orden: 0,
  } as KpiDefinicion;
  const req = (p: Partial<ReqKpi>): ReqKpi =>
    ({
      id: 'r',
      titulo_interno: 't',
      cliente_id: 'tyt',
      proyecto_id: null,
      owner_agencia: ['oscar'],
      prioridad: 'media',
      estado_operativo: 'completado',
      estado_aprobacion: 'no_aplica',
      fecha_entrega: '2026-10-10',
      fecha_entrega_original: '2026-10-10',
      completado_at: '2026-10-10T15:00:00.000Z',
      created_at: '2026-10-01T15:00:00.000Z',
      clase: 'tarea',
      proactiva: false,
      primera_respuesta_at: null,
      basecamp_url: null,
      responsables_cierre: null,
      heredada: false,
      ...p,
    }) as ReqKpi;
  const datos = (p: Partial<DatosKpi>): DatosKpi => ({
    completadas: [],
    creadas: [],
    decididas: [],
    reprocesos: [],
    reprogramaciones: [],
    eventos: [],
    ejecutivaProyecto: new Map(),
    clientes: new Map(),
    ...p,
  });
  it('sin ejecutiva en el proyecto, cuenta la del cliente; la del proyecto manda si está', () => {
    const d = datos({
      completadas: [req({ id: 'a' }), req({ id: 'b', proyecto_id: 'p1' })],
      ejecutivaCliente: new Map([['tyt', 'grace']]),
      ejecutivaProyecto: new Map([['p1', 'carolina']]),
    });
    const c = calcular(def, d, rangoPeriodo('2026-10'));
    expect(c.items.find((i) => i.req.id === 'a')?.miembros).toEqual(['oscar', 'grace']);
    expect(c.items.find((i) => i.req.id === 'b')?.miembros).toEqual(['oscar', 'carolina']);
  });
});

describe('daily publicado: mención de la ejecutiva', () => {
  it('sale en lo que vence y en los bloqueos, no en lo que se trabaja hoy', () => {
    const item = { cliente: 'Grupo Torres & Torres', titulo: 'Post', owner: 'Oscar', owners: ['Oscar'], fecha: null, url: null };
    const men = new Map([['Grace Franco', 'sgid-grace']]);
    const html = cuerpoDaily(
      {
        tipo: 'apertura',
        responsable: 'Elias',
        fecha: '2026-10-29',
        notas: [],
        hoy: [item],
        vencen: [{ ...item, cuenta: 'Grace Franco' }],
        bloqueos: [{ ...item, titulo: 'Bloqueada', cuenta: 'Grace Franco' }],
        cambios: [],
      },
      men,
    );
    expect(html.match(/Cuenta: <bc-attachment sgid="sgid-grace"/g)).toHaveLength(2);
  });
});

describe('salud del cliente (dashboard y ficha)', () => {
  const base = { atrasados: 0, atraso_max: 0, sin_movimiento_max: 0, entregas: 10, pct_a_tiempo: 90, reprocesos_equipo: 0 };
  it('verde sin motivos', () => expect(saludCliente(base)).toEqual({ salud: 'verde', motivos: [] }));
  it('rojo por atrasos, atraso largo, quietud o menos del 60 % a tiempo, con el porqué', () => {
    expect(saludCliente({ ...base, atrasados: 3 }).salud).toBe('rojo');
    expect(saludCliente({ ...base, atrasados: 1, atraso_max: 31 }).motivos).toContain('una tarea con 31 días de atraso');
    expect(saludCliente({ ...base, sin_movimiento_max: 15 }).salud).toBe('rojo');
    expect(saludCliente({ ...base, pct_a_tiempo: 55 })).toEqual({ salud: 'rojo', motivos: ['55 % a tiempo'] });
  });
  it('amarillo por una atrasada, menos del 80 % a tiempo o reprocesos en más del 20 % de las entregas', () => {
    expect(saludCliente({ ...base, atrasados: 1 })).toEqual({ salud: 'amarillo', motivos: ['1 tarea atrasada'] });
    expect(saludCliente({ ...base, pct_a_tiempo: 72 }).motivos).toEqual(['72 % a tiempo']);
    expect(saludCliente({ ...base, reprocesos_equipo: 3 }).motivos).toEqual(['reprocesos en el 30 % de las entregas']);
  });
  it('con menos de 5 entregas, el % a tiempo y los reprocesos no deciden', () => {
    expect(saludCliente({ ...base, entregas: 3, pct_a_tiempo: 0, reprocesos_equipo: 3 }).salud).toBe('verde');
  });
  it('reproceso del equipo: marcado, o por motivo que no es del cliente; sin motivo no cuenta', () => {
    expect(reprocesoDelEquipo({ atribuible: 'equipo', motivo: 'cambio_opinion_cliente' })).toBe(true);
    expect(reprocesoDelEquipo({ atribuible: null, motivo: 'error_ejecucion' })).toBe(true);
    expect(reprocesoDelEquipo({ atribuible: null, motivo: 'cambio_opinion_cliente' })).toBe(false);
    expect(reprocesoDelEquipo({ atribuible: null, motivo: null })).toBe(false);
  });
});

describe('trabajo medido en la salud', () => {
  it('cuenta lo pedido desde el 21/09/2026; lo importado de antes es historia', async () => {
    const { esTrabajoMedido } = await import('@backio/shared');
    expect(esTrabajoMedido({ fecha_pedido: '2026-06-02', created_at: '2026-10-28T15:00:00Z' })).toBe(false);
    expect(esTrabajoMedido({ fecha_pedido: '2026-09-22', created_at: '2026-09-22T15:00:00Z' })).toBe(true);
    expect(esTrabajoMedido({ fecha_pedido: null, created_at: '2026-09-21T15:00:00Z' })).toBe(true);
  });
});

describe('lo que espera al cliente no cuenta para la salud', () => {
  it('su atraso y su quietud quedan fuera; las demás sí cuentan', async () => {
    const { operacionParaSalud } = await import('@backio/shared');
    expect(
      operacionParaSalud([
        { dias_atraso: 44, dias_sin_movimiento: 31, estado_aprobacion: 'pendiente_cliente' },
        { dias_atraso: 9, dias_sin_movimiento: 10, estado_aprobacion: 'no_aplica' },
        { dias_atraso: 0, dias_sin_movimiento: 2, estado_aprobacion: 'pendiente_interno' },
      ]),
    ).toEqual({ atrasados: 1, atraso_max: 9, sin_movimiento_max: 10 });
  });
});
