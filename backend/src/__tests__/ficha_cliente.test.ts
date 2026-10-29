import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AuthInfo } from '../lib/auth/middleware';

const m = vi.hoisted(() => {
  process.env.SUPABASE_URL = 'https://prueba.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  return {
    activos: [] as Record<string, unknown>[],
    completados: [] as Record<string, unknown>[],
    reprocesos: [] as Record<string, unknown>[],
    senales: [] as Record<string, unknown>[],
    generar: vi.fn(),
  };
});
vi.mock('../lib/db/clientes', async (orig) => ({
  ...(await orig<object>()),
  getCliente: async (_c: unknown, id: string) =>
    id === 'tyt'
      ? {
          id: 'tyt',
          nombre: 'Grupo Torres & Torres',
          mesa_id: 'omega',
          ejecutiva_id: 'grace',
          logo_url: null,
          color_primario: null,
          activo: true,
        }
      : null,
}));
vi.mock('../lib/db/mesas', async (orig) => ({
  ...(await orig<object>()),
  getMesa: async () => ({ id: 'omega', nombre: 'Mesa Omega', lider_id: 'elias' }),
}));
vi.mock('../lib/db/usuarios', () => ({
  listUsuarios: async () => [
    { id: 'grace', nombre: 'Grace Franco', activo: true, avatar_url: 'https://bc/grace.png', email: 'grace@geeks.ec' },
    { id: 'elias', nombre: 'Elias Plazarte', activo: true, avatar_url: null, email: null },
    { id: 'oscar', nombre: 'Oscar Borja', activo: true, avatar_url: null, email: null },
  ],
}));
vi.mock('../lib/db/proyectos', () => ({
  listProyectos: async () => [
    { id: 'p1', nombre: 'Libro T&T', estado: 'en_curso', avance: 40, fecha_entrega: null, valor_cotizado: '1200' },
  ],
}));
vi.mock('../lib/db/requerimientos', () => ({ listBacklog: async () => m.activos }));
vi.mock('../lib/db/dashboard', () => ({ listCompletadosDesde: async () => m.completados }));
vi.mock('../lib/db/historial', () => ({ listCumplimientoDesde: async () => ({ reprogramaciones: [], reprocesos: m.reprocesos }) }));
vi.mock('../lib/horas', () => ({ resumenHoras: async () => ({ total: 12.5, por_proyecto: { p1: 12.5 } }) }));
vi.mock('../lib/db/semanas', async (orig) => ({
  ...(await orig<object>()),
  ensureSemana: async () => ({ id: 's' }),
  listSenales: async () => m.senales,
}));
vi.mock('../lib/ia/index', async (orig) => ({ ...(await orig<object>()), generarJson: m.generar, iaDisponible: () => false }));

const { fichaCliente } = await import('../lib/clientes/ficha');
const { clientes } = await import('../routes/v1/clientes');

const ahora = new Date('2026-10-29T15:00:00Z');
const ctx = { tenantId: 't', usuarioId: null, origen: 'ui' } as never;
const tarea = (id: string, p: Record<string, unknown>) => ({
  id,
  cliente_id: 'tyt',
  proyecto_id: 'p1',
  titulo_interno: id,
  owner_agencia: ['oscar'],
  estado_operativo: 'en_ejecucion',
  estado_aprobacion: 'no_aplica',
  fecha_entrega: '2026-11-10',
  fecha_entrega_original: '2026-11-10',
  completado_at: null,
  heredada: false,
  dias_atraso: 0,
  dias_sin_movimiento: 1,
  basecamp_url: null,
  ...p,
});

beforeEach(() => {
  m.activos = [
    tarea('atrasada', { dias_atraso: 4, fecha_entrega: '2026-10-25' }),
    tarea('esperando', { estado_aprobacion: 'pendiente_cliente' }),
  ];
  m.completados = [
    ...Array.from({ length: 4 }, (_, i) =>
      tarea(`ok${i}`, { estado_operativo: 'completado', fecha_entrega_original: '2026-10-20', completado_at: '2026-10-19T15:00:00Z' }),
    ),
    tarea('tarde', { estado_operativo: 'completado', fecha_entrega_original: '2026-10-10', completado_at: '2026-10-15T15:00:00Z' }),
  ];
  // Un reproceso de una tarea de otro cliente no cuenta.
  m.reprocesos = [
    { requerimiento_id: 'ok0', abierto_at: '2026-10-18T15:00:00Z', motivo: 'error_ejecucion', atribuible: null },
    { requerimiento_id: 'de-otro-cliente', abierto_at: '2026-10-18T15:00:00Z', motivo: 'error_ejecucion', atribuible: null },
  ];
  m.senales = [
    {
      id: 's1',
      entidad_tipo: 'cliente',
      entidad_id: 'tyt',
      detalle: {},
      severidad: 'alta',
      tipo: 'cuenta_silenciosa',
      titulo: 'x',
      atendida: false,
    },
    {
      id: 's2',
      entidad_tipo: 'requerimiento',
      entidad_id: 'atrasada',
      detalle: {},
      severidad: 'critica',
      tipo: 'atraso_critico',
      titulo: 'y',
      atendida: false,
    },
    {
      id: 's3',
      entidad_tipo: 'requerimiento',
      entidad_id: 'ajena',
      detalle: {},
      severidad: 'media',
      tipo: 'sin_movimiento',
      titulo: 'z',
      atendida: false,
    },
  ];
  m.generar.mockReset();
});

describe('ficha del cliente', () => {
  it('arma ejecutiva, mesa con líder, salud con su porqué e indicadores solo del cliente', async () => {
    const f = (await fichaCliente(ctx, 'tyt', ahora))!;
    expect(f.ejecutiva).toMatchObject({ nombre: 'Grace Franco', avatar_url: 'https://bc/grace.png' });
    expect(f.mesa).toMatchObject({ nombre: 'Mesa Omega', lider: { nombre: 'Elias Plazarte' } });
    expect(f.indicadores).toMatchObject({
      entregas_90d: 5,
      pct_a_tiempo_90d: 80,
      reprocesos_90d: 1,
      reprocesos_equipo_90d: 1,
      atrasados: 1,
      esperando_cliente: 1,
      horas_30d: 12.5,
    });
    expect(f.salud).toEqual({ salud: 'amarillo', motivos: ['1 tarea atrasada'] });
    expect(f.tareas.atrasadas.map((t) => t.id)).toEqual(['atrasada']);
    expect(f.tareas.ultimas_completadas[0]).toMatchObject({ responsables: ['Oscar Borja'] });
    expect(f.tareas.ultimas_completadas.find((t) => t.id === 'tarde')?.a_tiempo).toBe(false);
    expect(f.senales.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(f.mensual).toHaveLength(6);
    expect(f.mensual.at(-1)).toMatchObject({ mes: '2026-10', entregas: 5, pct_a_tiempo: 80, reprocesos: 1 });
    expect(f.proyectos[0]).toMatchObject({ nombre: 'Libro T&T', activos: 2, atrasados: 1, horas_30d: 12.5, valor_cotizado: 1200 });
  });
  it('cliente que no existe: null', async () => {
    expect(await fichaCliente(ctx, 'nadie', ahora)).toBeNull();
  });
});

const sesion = (rol: string): AuthInfo =>
  ({
    tipo: 'usuario',
    rol,
    scopes: [],
    nombre: 'x',
    perfil: 'sesion',
    ctx: { db: {}, tenantId: 't', usuarioId: 'u1', origen: 'ui' },
  }) as never;
const app = (rol: string) =>
  new Hono()
    .use('*', async (c, next) => {
      c.set('auth', sesion(rol));
      await next();
    })
    .route('/clientes', clientes);

describe('rutas de la ficha', () => {
  it('un colaborador no ve la ficha', async () => {
    expect((await app('colaborador').request('/clientes/tyt/ficha')).status).toBe(403);
    expect((await app('ejecutiva').request('/clientes/tyt/ficha')).status).toBe(200);
  });
  it('sin API key no se generan sugerencias', async () => {
    expect((await app('ejecutiva').request('/clientes/tyt/sugerencias', { method: 'POST' })).status).toBe(503);
    expect(m.generar).not.toHaveBeenCalled();
  });
});
