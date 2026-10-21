import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderActaCierre } from '../lib/rituals/documents';

const e = vi.hoisted(() => ({
  activos: [] as Record<string, unknown>[],
  guardadas: [] as Record<string, unknown>[],
  acuerdos: [] as Record<string, unknown>[],
  prueba: new Set<string>(),
  atendidas: new Map<string, { severidad: 'critica' | 'alta' | 'media'; atendida_por: string | null; atendida_at: string | null }>(),
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
vi.mock('../lib/db/semanas', async () => ({
  listSenales: async () => e.guardadas,
  listAcuerdosAbiertos: async () => e.acuerdos,
  listAcuerdosSemana: async () => [],
  ensureSemana: async () => null,
  getSemana: async () => null,
  replaceSenales: async () => [],
  insertActa: async () => null,
  atendidasRecientes: async () => e.atendidas,
  atendidaVigente: (await vi.importActual<typeof import('../lib/db/semanas')>('../lib/db/semanas')).atendidaVigente,
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
  // Migración 35: el acuerdo es de la mesa en cuyo weekly se acordó, no de las mesas donde trabaja el responsable.
  it('los acuerdos de una mesa son los acordados en ella (aunque el responsable trabaje en otra o en ninguna)', async () => {
    e.acuerdos = [
      { id: 'a1', responsable_id: 'elias', mesa_id: 'm-omega' },
      { id: 'a2', responsable_id: 'elias', mesa_id: 'm-orion' },
      { id: 'a3', responsable_id: 'directora-sin-tareas', mesa_id: 'm-omega' },
      { id: 'a4', responsable_id: 'elias', mesa_id: null },
    ];
    expect((await acuerdosAbiertosDeMesa(ctx, 'm-omega')).map((a) => a.id)).toEqual(['a1', 'a3']);
    expect((await acuerdosAbiertosDeMesa(ctx, null)).map((a) => a.id)).toEqual(['a1', 'a2', 'a3', 'a4']);
  });
  it('una señal atendida la semana pasada sigue atendida si no empeoró; si empeoró, vuelve', async () => {
    e.activos = [tarea('omega', { id: 'r1' })];
    e.guardadas = [];
    const [s] = await senalesDeMesa(ctx, semana, 'm-omega');
    e.atendidas = new Map([[`${s!.tipo}:r1`, { severidad: s!.severidad, atendida_por: 'luis', atendida_at: '2026-10-09T15:00:00Z' }]]);
    const [mismo] = await senalesDeMesa(ctx, semana, 'm-omega');
    expect(mismo).toMatchObject({ atendida: true, atendida_por: 'luis' });
    e.atendidas = new Map([[`${s!.tipo}:r1`, { severidad: 'media', atendida_por: 'luis', atendida_at: '2026-10-09T15:00:00Z' }]]);
    if (s!.severidad !== 'media') expect((await senalesDeMesa(ctx, semana, 'm-omega'))[0]).toMatchObject({ atendida: false });
    e.atendidas = new Map();
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
