import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderActaCierre } from '../lib/rituals/documents';

const e = vi.hoisted(() => ({
  activos: [] as Record<string, unknown>[],
  guardadas: [] as Record<string, unknown>[],
  acuerdos: [] as Record<string, unknown>[],
  prueba: new Set<string>(),
}));

vi.mock('../lib/db/requerimientos', () => ({
  listBacklog: async (_c: unknown, f: { mesa?: { clienteIds: string[] } }) =>
    f.mesa ? e.activos.filter((r) => f.mesa!.clienteIds.includes(r.cliente_id as string)) : e.activos,
}));
vi.mock('../lib/db/usuarios', () => ({
  listUsuarios: async () => [{ id: 'elias', nombre: 'Elias', activo: true, capacidad_semanal: 40 }],
}));
vi.mock('../lib/db/clientes', () => ({
  listClientes: async () => [
    { id: 'omega', nombre: 'Banco Amazonas', activo: true },
    { id: 'orion', nombre: 'AB-Inbev', activo: true },
    { id: 'acme', nombre: 'Acme', activo: true },
  ],
  idsClientesDePrueba: async () => e.prueba,
}));
vi.mock('../lib/db/mesas', () => ({
  getMesa: async () => ({ id: 'm-omega', nombre: 'Mesa Omega' }),
  alcanceMesa: async () => ({ clienteIds: ['omega', 'acme'], proyectoIds: [] }),
}));
vi.mock('../lib/db/semanas', () => ({
  listSenales: async () => e.guardadas,
  listAcuerdosAbiertos: async () => e.acuerdos,
  listAcuerdosSemana: async () => [],
  ensureSemana: async () => null,
  getSemana: async () => null,
  replaceSenales: async () => [],
  insertActa: async () => null,
}));
vi.mock('../lib/db/historial', () => ({ listSinMotivo: async () => ({ reprogramaciones: [], reprocesos: [] }) }));
vi.mock('../lib/db/rituales', () => ({ getUmbralesSenales: async () => ({}), listCompletadosRecientes: async () => [] }));

const { senalesDeMesa, acuerdosAbiertosDeMesa } = await import('../lib/rituals/service');

const semana = { id: 's42', fecha_inicio: '2026-10-12', fecha_fin: '2026-10-18', numero_iso: 42 } as never;
const ctx = { tenantId: 't', usuarioId: null, origen: 'ui' } as never;
const tarea = (cliente: string, extra: Record<string, unknown> = {}) => ({
  id: `${cliente}-${Math.random()}`,
  cliente_id: cliente,
  titulo_interno: `Tarea ${cliente}`,
  owner_agencia: ['elias'],
  estado_operativo: 'priorizado',
  estado_aprobacion: 'no_aplica',
  fecha_entrega: '2026-09-01',
  veces_reprogramado: 3,
  veces_reproceso: 0,
  dias_atraso: 45,
  dias_sin_movimiento: 1,
  ...extra,
});

beforeEach(() => {
  e.activos = [tarea('omega'), tarea('orion'), tarea('acme')];
  e.guardadas = [];
  e.acuerdos = [];
  e.prueba = new Set(['acme']);
});

// 19/10/2026: el cierre de Omega traía señales de AB-Inbev (Orión) y de Acme (cliente de prueba).
describe('weekly y actas por mesa', () => {
  it('las señales de una mesa salen solo de sus clientes, sin los de prueba', async () => {
    const s = await senalesDeMesa(ctx, semana, 'm-omega');
    const titulos = s.map((x) => x.titulo).join(' | ');
    expect(titulos).toContain('Banco Amazonas');
    expect(titulos).not.toContain('AB-Inbev');
    expect(titulos).not.toContain('Acme');
  });
  it('respeta las señales ya marcadas como atendidas', async () => {
    const [primera] = await senalesDeMesa(ctx, semana, 'm-omega');
    e.guardadas = [{ ...primera, id: 'guardada-1', atendida: true }];
    const s = await senalesDeMesa(ctx, semana, 'm-omega');
    expect(s.find((x) => x.id === 'guardada-1')?.atendida).toBe(true);
  });
  it('sin mesa, son las señales guardadas de la semana', async () => {
    e.guardadas = [{ id: 'g', titulo: 'x' }];
    expect(await senalesDeMesa(ctx, semana, null)).toEqual(e.guardadas);
  });
  it('los acuerdos de una mesa son los de quienes trabajan en ella', async () => {
    e.acuerdos = [
      { id: 'a1', responsable_id: 'elias' },
      { id: 'a2', responsable_id: 'alguien-de-orion' },
    ];
    expect((await acuerdosAbiertosDeMesa(ctx, 'm-omega')).map((a) => a.id)).toEqual(['a1']);
  });
});

describe('acta de cierre: resultado y arrastre', () => {
  it('las canceladas no cuentan en el resultado ni pasan al arrastre', () => {
    const p = (estado: string) => ({ ...tarea('omega'), estado_operativo: estado, prioridad: 'media', fecha_entrega: '2026-10-15' });
    const md = renderActaCierre({
      semana: { numero_iso: 42, fecha_inicio: '2026-10-12', fecha_fin: '2026-10-18' },
      mesa: 'Mesa Omega',
      capacidad: [],
      prioridades: [p('completado'), p('completado'), p('en_ejecucion'), p('cancelado'), p('cancelado')],
      riesgos: [],
      pendientes_anteriores: [],
      usuarios: [],
      clientes: [{ id: 'omega', nombre: 'Banco Amazonas' }],
      senales: [],
      acuerdos_semana: [],
    } as never);
    expect(md).toContain('**Resultado:** 2 de 3 tareas completadas (67%); 2 canceladas no cuentan.');
    expect(md).toContain('## 2. Arrastre a la siguiente semana (1)');
  });
});
