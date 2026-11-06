import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ filas: [] as Record<string, unknown>[] }));
vi.mock('../lib/db/informes', () => ({
  listClientesCanal: async () => [
    { id: 'cad', nombre: 'AB-Inbev || TRADE KKAA: CADENAS - FEE de agencia', color_primario: null, config: {} },
  ],
  listRequerimientosCanal: async () => m.filas,
  getConfigTenantInformes: async () => null,
  listClientesActivosConfig: async () => [],
}));
const { informeCanal } = await import('../lib/informe_canal');

const r = (piezas: number, fecha_entrega: string | null, estado_operativo = 'completado') => ({
  cliente_id: 'cad',
  piezas,
  estado_operativo,
  estado_aprobacion: 'aprobado',
  prioridad: 'media',
  fecha_entrega,
});
const ctx = {} as never;

beforeEach(() => {
  m.filas = [];
});

// 6/11/2026: Grace no cuadraba septiembre de CADENAS. Una tarea de 259 piezas creada el 14/09 sin fecha de pedido y
// entregada el 15/10 caía en septiembre; ella cuenta por fecha de entrega, como en Monday.
describe('informe por canal por fecha de entrega', () => {
  it('cada tarea cuenta en el mes y la semana de su entrega', async () => {
    m.filas = [r(259, '2026-10-15'), r(25, '2026-09-30'), r(4, '2026-09-30'), r(9, '2026-08-31')];
    const d = await informeCanal(ctx, { clienteIds: ['cad'], desde: '2026-09-01', hasta: '2026-10-31' });
    expect(d.por_mes.map((x) => [x.mes, x.piezas, x.tareas])).toEqual([
      ['2026-09', 29, 2],
      ['2026-10', 259, 1],
    ]);
    expect(d.totales).toMatchObject({ piezas: 288, tareas: 3 });
    expect(d.por_semana.reduce((s, x) => s + x.piezas, 0)).toBe(288);
    expect(d.por_semana.find((x) => x.semana === '2026-10-12')?.piezas).toBe(259);
  });
  it('avisa de lo abierto sin fecha, y no cuenta lo cerrado sin fecha', async () => {
    m.filas = [r(3, null, 'en_ejecucion'), r(7, null), r(5, '2026-09-10')];
    const d = await informeCanal(ctx, { clienteIds: ['cad'], desde: '2026-09-01', hasta: '2026-10-31' });
    expect(d.sin_fecha).toEqual({ tareas: 1, piezas: 3 });
    expect(d.totales.piezas).toBe(5);
  });
});
