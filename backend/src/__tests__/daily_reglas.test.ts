import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AuthInfo } from '../lib/auth/middleware';
import type { Requerimiento } from '@backio/shared';

const m = vi.hoisted(() => {
  process.env.SUPABASE_URL = 'https://prueba.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  return {
    reprogramaciones: [] as { requerimiento_id: string; created_at: string; motivo: string | null }[],
    bloqueos: [] as { entidad_id: string; created_at: string }[],
    publicaciones: [] as { accion: string; created_at: string; detalle: { message_id?: number } }[],
    publicar: vi.fn(),
    audit: vi.fn(),
    armar: vi.fn(),
  };
});
vi.mock('../lib/db/evolutivo', async (orig) => ({
  ...(await orig<object>()),
  listReprogramacionesDesde: async () => m.reprogramaciones,
  listEventosBloqueo: async () => m.bloqueos,
  listPublicacionesDaily: async () => m.publicaciones,
}));
vi.mock('../lib/db/audit', () => ({ audit: m.audit }));
vi.mock('../lib/db/mesas', async (orig) => ({
  ...(await orig<object>()),
  getMesa: async () => ({ id: 'm1', nombre: 'Mesa Omega' }),
  listMesas: async () => [],
}));
vi.mock('../lib/db/clientes', async (orig) => ({ ...(await orig<object>()), listClientes: async () => [] }));
vi.mock('../lib/db/requerimientos', async (orig) => ({ ...(await orig<object>()), listBacklog: async () => [] }));
vi.mock('../lib/mcp/publish', async (orig) => ({ ...(await orig<object>()), publicarDailyEnBasecamp: m.publicar }));
vi.mock('../lib/ia/daily', async (orig) => ({ ...(await orig<object>()), armarDailyMensaje: m.armar }));

const { seccionesDaily, avisosAntesDePublicar } = await import('../lib/rituals/daily');
const { semanas } = await import('../routes/v1/semanas');

const ctx = { tenantId: 't', usuarioId: null, origen: 'ui' } as never;
const ahora = new Date('2026-10-29T15:00:00Z'); // 10:00 en Guayaquil
const hace = (h: number) => new Date(ahora.getTime() - h * 3_600_000).toISOString();
const tarea = (id: string, extra: Partial<Requerimiento> = {}) =>
  ({
    id,
    daily_fecha: null,
    fecha_entrega: '2026-11-20',
    estado_operativo: 'en_ejecucion',
    ultima_actualizacion: hace(2),
    ...extra,
  }) as Pick<Requerimiento, 'id' | 'daily_fecha' | 'fecha_entrega' | 'estado_operativo' | 'ultima_actualizacion'>;

beforeEach(() => {
  m.reprogramaciones = [];
  m.bloqueos = [];
  m.publicaciones = [];
  Object.values(m).forEach((f) => typeof f === 'function' && f.mockReset());
});

// 29/10/2026: el tablero y el mensaje tenían reglas distintas y no coincidían.
describe('reglas del daily (tablero, mensaje y borrador)', () => {
  it('cambios de fecha: los de reprogramaciones (también los hechos en Basecamp), no cualquier movimiento', async () => {
    m.reprogramaciones = [{ requerimiento_id: 'desde-basecamp', created_at: hace(3), motivo: null }];
    const s = await seccionesDaily(ctx, [tarea('desde-basecamp'), tarea('solo-movida', { ultima_actualizacion: hace(1) })], ahora);
    expect(s.cambios.map((r) => r.id)).toEqual(['desde-basecamp']);
  });
  it('bloqueo nuevo: según cuándo pasó a bloqueado, no cuándo se movió por última vez', async () => {
    m.bloqueos = [
      { entidad_id: 'viejo', created_at: hace(24 * 5) },
      { entidad_id: 'nuevo', created_at: hace(30) },
      { entidad_id: 'nuevo', created_at: hace(4) },
    ];
    const s = await seccionesDaily(
      ctx,
      [
        tarea('viejo', { estado_operativo: 'bloqueado', ultima_actualizacion: hace(1) }),
        tarea('nuevo', { estado_operativo: 'bloqueado', ultima_actualizacion: hace(1) }),
        tarea('sin-registro', { estado_operativo: 'bloqueado', ultima_actualizacion: hace(5) }),
        tarea('sin-registro-viejo', { estado_operativo: 'bloqueado', ultima_actualizacion: hace(48) }),
      ],
      ahora,
    );
    expect(s.bloqueos.map((r) => r.id)).toEqual(['nuevo', 'sin-registro']);
  });
  it('hoy y vencen: selección del día y priorizadas que vencen hasta mañana', async () => {
    const s = await seccionesDaily(
      ctx,
      [
        tarea('hoy', { daily_fecha: '2026-10-29' }),
        tarea('vence', { estado_operativo: 'priorizado', fecha_entrega: '2026-10-30' }),
        tarea('vence-en-curso', { fecha_entrega: '2026-10-30' }),
      ],
      ahora,
    );
    expect(s.hoy.map((r) => r.id)).toEqual(['hoy']);
    expect(s.vencen.map((r) => r.id)).toEqual(['vence']);
  });
  // Apertura del 30/10/2026: «Vence hoy o mañana» traía tareas con 63 días de atraso.
  it('lo atrasado sin iniciar va aparte, de lo más viejo a lo más nuevo, y no en «vence»', async () => {
    const s = await seccionesDaily(
      ctx,
      [
        tarea('atrasada-1d', { estado_operativo: 'priorizado', fecha_entrega: '2026-10-28' }),
        tarea('atrasada-63d', { estado_operativo: 'priorizado', fecha_entrega: '2026-08-27' }),
        tarea('vence-hoy', { estado_operativo: 'priorizado', fecha_entrega: '2026-10-29' }),
        tarea('atrasada-en-curso', { fecha_entrega: '2026-10-01' }),
      ],
      ahora,
    );
    expect(s.vencen.map((r) => r.id)).toEqual(['vence-hoy']);
    expect(s.atrasadas.map((r) => r.id)).toEqual(['atrasada-63d', 'atrasada-1d']);
  });
});

const sesion = {
  tipo: 'usuario',
  rol: 'operaciones',
  scopes: [],
  nombre: 'Ana',
  perfil: 'sesion',
  ctx: { db: {}, tenantId: 't', usuarioId: 'u1', origen: 'ui' },
} as unknown as AuthInfo;
const app = () =>
  new Hono()
    .use('*', async (c, next) => {
      c.set('auth', sesion);
      await next();
    })
    .route('/semanas', semanas);
const publicar = (body: Record<string, unknown>) =>
  app().request('/semanas/daily/publicar', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // «tarde» depende de la hora a la que corre el test: aquí se da por confirmado (tiene su propio test).
    body: JSON.stringify({ mesa_id: '40000000-0000-4000-8000-000000000002', tipo: 'apertura', confirmado: ['tarde'], ...body }),
  });
const mensaje = {
  tipo: 'apertura',
  responsable: 'Ana',
  fecha: '2026-10-29',
  notas: [],
  hoy: [{ cliente: 'Banco Amazonas', titulo: 'Post', owner: 'Elias', fecha: null, url: null }],
  vencen: [],
  atrasadas: [],
  bloqueos: [],
  cambios: [],
};

describe('publicar el daily una vez por mesa, día y tipo', () => {
  it('si la apertura ya salió hoy, no la publica otra vez sin confirmación', async () => {
    m.publicaciones = [{ accion: 'publicar_daily_apertura', created_at: new Date().toISOString(), detalle: { message_id: 1 } }];
    const res = await publicar({});
    expect(res.status).toBe(409);
    expect(((await res.json()) as { ya_publicado: boolean }).ya_publicado).toBe(true);
    expect(m.publicar).not.toHaveBeenCalled();
  });
  it('con repetir, la publica; y el cierre no cuenta como apertura', async () => {
    m.armar.mockResolvedValue(mensaje);
    m.publicar.mockResolvedValue({ id: 2, url: 'https://bc/2' });
    m.publicaciones = [{ accion: 'publicar_daily_cierre', created_at: new Date().toISOString(), detalle: {} }];
    expect((await publicar({})).status).toBe(200);
    m.publicaciones.push({ accion: 'publicar_daily_apertura', created_at: new Date().toISOString(), detalle: {} });
    expect((await publicar({ repetir: true })).status).toBe(200);
    expect(m.publicar).toHaveBeenCalledTimes(2);
  });
  it('dos clics simultáneos: el segundo espera al primero y ve que ya salió', async () => {
    m.armar.mockResolvedValue(mensaje);
    m.publicar.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { id: 3, url: 'https://bc/3' };
    });
    m.audit.mockImplementation(async (_c: unknown, e: { accion: string }) => {
      m.publicaciones.push({ accion: e.accion, created_at: new Date().toISOString(), detalle: {} });
    });
    const [a, b] = await Promise.all([publicar({}), publicar({})]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(m.publicar).toHaveBeenCalledTimes(1);
  });
});

// Apertura de Omega del 30/10/2026: una ejecutiva con sus tareas del día en Orión la publicó a las 17:23, vacía.
describe('confirmar antes de publicar el daily', () => {
  const base = {
    tipo: 'apertura' as const,
    mesa: { id: 'omega', nombre: 'Mesa Omega', lider_id: 'julio' },
    usuarioId: 'grace',
    llevaTodas: false,
    mesasDeSusCuentas: new Set<string>(),
    publicoAntes: false,
    hora: '10:30',
    hoySeTrabaja: 5,
    suHoyEnOtrasMesas: [],
    liderNombre: 'Julio Lucio',
  };
  const motivos = (x: Partial<typeof base>) => avisosAntesDePublicar({ ...base, ...x }).map((a) => a.motivo);

  it('mesa ajena: sin ser líder, sin cuentas ahí y sin haberla publicado antes', () => {
    expect(motivos({})).toEqual(['otra_mesa']);
    expect(motivos({ usuarioId: 'julio' })).toEqual([]);
    expect(motivos({ mesasDeSusCuentas: new Set(['omega']) })).toEqual([]);
    expect(motivos({ publicoAntes: true })).toEqual([]);
    expect(motivos({ llevaTodas: true })).toEqual([]);
  });
  it('apertura desde las 14:00 y apertura sin nada elegido para hoy (dice dónde están las tuyas)', () => {
    expect(motivos({ publicoAntes: true, hora: '13:59' })).toEqual([]);
    expect(motivos({ publicoAntes: true, hora: '17:23' })).toEqual(['tarde']);
    const a = avisosAntesDePublicar({ ...base, publicoAntes: true, hoySeTrabaja: 0, suHoyEnOtrasMesas: ['Mesa Orión'] });
    expect(a.map((x) => x.motivo)).toEqual(['sin_hoy']);
    expect(a[0]!.mensaje).toContain('Las tareas que elegiste para hoy son de Mesa Orión.');
  });
  it('el cierre no pide hora ni selección', () => {
    expect(motivos({ tipo: 'cierre' as never, publicoAntes: true, hora: '18:00', hoySeTrabaja: 0 })).toEqual([]);
  });
  it('la ruta responde 409 con los motivos y publica cuando se confirman', async () => {
    m.publicaciones = [];
    m.publicar.mockReset().mockResolvedValue({ id: 9, url: 'https://bc/9' });
    m.armar.mockResolvedValue({ ...mensaje, hoy: [] });
    const r = await publicar({});
    expect(r.status).toBe(409);
    expect(((await r.json()) as { motivos: string[] }).motivos).toEqual(['sin_hoy']);
    expect(m.publicar).not.toHaveBeenCalled();
    expect((await publicar({ confirmado: ['tarde', 'sin_hoy'] })).status).toBe(200);
  });
});
