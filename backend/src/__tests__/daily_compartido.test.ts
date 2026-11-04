import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AuthInfo } from '../lib/auth/middleware';

const m = vi.hoisted(() => {
  process.env.SUPABASE_URL = 'https://prueba.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  return {
    publicaciones: [] as { accion: string; created_at: string; usuario_id: string | null; detalle: Record<string, unknown> }[],
    agregados: [] as { accion: string; created_at: string; usuario_id: string | null; detalle: Record<string, unknown> }[],
    prep: [] as { usuario_id: string; notas: string[]; listo_at: string | null; updated_at: string }[],
    publicar: vi.fn(),
    comentar: vi.fn(),
    audit: vi.fn(),
    armar: vi.fn(),
    guardar: vi.fn(),
    notificar: vi.fn(),
    clientes: [] as { id: string; activo: boolean; mesa_id: string | null; ejecutiva_id: string | null; nombre: string }[],
    mesas: [] as Record<string, unknown>[],
  };
});
vi.mock('../lib/db/evolutivo', async (orig) => ({
  ...(await orig<object>()),
  listPublicacionesDaily: async () => m.publicaciones,
  listAgregadosDaily: async () => m.agregados,
}));
vi.mock('../lib/db/daily_preparacion', () => ({ listPreparacion: async () => m.prep, guardarPreparacion: m.guardar }));
vi.mock('../lib/db/audit', () => ({ audit: m.audit }));
vi.mock('../lib/db/usuarios', async (orig) => ({
  ...(await orig<object>()),
  listUsuarios: async () => [
    { id: 'caro', nombre: 'Carolina Suarez', activo: true },
    { id: 'grace', nombre: 'Grace Franco', activo: true },
  ],
}));
vi.mock('../lib/db/mesas', async (orig) => ({
  ...(await orig<object>()),
  getMesa: async () => ({
    id: 'm1',
    nombre: 'Mesa Omega',
    activa: true,
    basecamp_project_id: 9,
    basecamp_board_daily_id: 8,
    lider_id: null,
  }),
  listMesas: async () => m.mesas,
  alcanceMesa: async () => ({ clienteIds: [], proyectoIds: [] }),
}));
vi.mock('../lib/db/clientes', async (orig) => ({
  ...(await orig<object>()),
  listClientes: async () => m.clientes,
  idsClientesDePrueba: async () => new Set<string>(),
}));
vi.mock('../lib/db/requerimientos', async (orig) => ({ ...(await orig<object>()), listBacklog: async () => [] }));
vi.mock('../lib/mcp/publish', async (orig) => ({
  ...(await orig<object>()),
  publicarDailyEnBasecamp: m.publicar,
  comentarDailyEnBasecamp: m.comentar,
  personasDelProyectoDaily: async () => 17,
}));
vi.mock('../lib/ia/daily', async (orig) => ({ ...(await orig<object>()), armarDailyMensaje: m.armar }));
vi.mock('../lib/notificaciones', async (orig) => ({ ...(await orig<object>()), notificar: m.notificar }));

const {
  destinatariosRecordatorio,
  faltanEnDaily,
  huellaDaily,
  notasUnificadas,
  pendienteDeAgregar,
  personasDaily,
  recordarDaily,
  responsablesDaily,
} = await import('../lib/rituals/daily_compartido');
const { cuerpoAgregado } = await import('../lib/mcp/publish');
const { semanas } = await import('../routes/v1/semanas');

const nombre = (id: string) => ({ caro: 'Carolina Suarez', grace: 'Grace Franco' })[id] ?? 'Alguien';
const fila = (usuario_id: string, notas: string[] = [], listo_at: string | null = null) => ({
  usuario_id,
  notas,
  listo_at,
  updated_at: '',
});
const item = (id: string, cliente = 'Banco Amazonas') => ({ id, cliente, titulo: `Tarea ${id}`, owner: 'Elias', fecha: null, url: null });
const mensaje = (extra = {}) => ({
  tipo: 'apertura' as const,
  responsable: 'Carolina',
  fecha: '2026-11-04',
  notas: [] as string[],
  hoy: [item('a')],
  vencen: [],
  atrasadas: [],
  bloqueos: [],
  cambios: [],
  ...extra,
});

beforeEach(() => {
  m.publicaciones = [];
  m.agregados = [];
  m.prep = [];
  m.clientes = [];
  m.mesas = [];
  for (const f of [m.publicar, m.comentar, m.audit, m.armar, m.guardar, m.notificar]) f.mockReset();
  m.notificar.mockResolvedValue(1);
  m.armar.mockImplementation(async (_c, _m, _t, notas: string[], responsable: string) => mensaje({ notas, responsable }));
});

describe('notas y responsables de varias ejecutivas', () => {
  it('con una autora las notas van tal cual; con varias, cada una dice de quién es', () => {
    expect(notasUnificadas([fila('caro', ['Cliente viaja'])], nombre)).toEqual(['Cliente viaja']);
    expect(notasUnificadas([fila('caro', ['Uno']), fila('grace', ['Dos'])], nombre)).toEqual(['Carolina: Uno', 'Grace: Dos']);
  });
  it('salen como responsables quienes prepararon y quien publica, sin repetir', () => {
    expect(responsablesDaily([fila('caro', ['x']), fila('grace', [], 'ya')], nombre, 'Grace Franco')).toBe(
      'Carolina Suarez y Grace Franco',
    );
    expect(responsablesDaily([], nombre, 'Grace Franco')).toBe('Grace Franco');
    expect(responsablesDaily([fila('grace')], nombre, 'Carolina Suarez')).toBe('Carolina Suarez');
  });
});

describe('quién falta', () => {
  const clientes = [
    { id: 'c1', ejecutiva_id: 'caro' },
    { id: 'c2', ejecutiva_id: 'caro' },
    { id: 'c3', ejecutiva_id: 'grace' },
  ];
  it('cuenta cuentas y tareas de hoy por ejecutiva, y es solo información', () => {
    const p = personasDaily(
      clientes,
      [{ cliente_id: 'c3' }, { cliente_id: 'c3' }, { cliente_id: 'c1' }],
      [fila('caro', [], 'hora')],
      nombre,
    );
    expect(p.map((x) => [x.usuario_id, x.cuentas, x.tareas_hoy])).toEqual([
      ['caro', 2, 1],
      ['grace', 1, 2],
    ]);
    expect(faltanEnDaily(p, 'caro')).toEqual(['Grace no ha marcado su parte: 1 cuenta, 2 tareas para hoy.']);
    expect(faltanEnDaily(p, 'grace')).toEqual([]);
  });
});

describe('qué falta sumar a un daily publicado', () => {
  it('solo tareas y notas nuevas', () => {
    const m1 = mensaje({ notas: ['Uno'], hoy: [item('a')] });
    const m2 = mensaje({ notas: ['Carolina: Uno', 'Grace: Dos'], hoy: [item('a'), item('b')] });
    const a = pendienteDeAgregar(m2, [huellaDaily(m1)]);
    expect(a.hoy.map((i) => i.id)).toEqual(['b']);
    expect(a.notas).toEqual(['Grace: Dos']);
    expect(a.vacio).toBe(false);
    expect(pendienteDeAgregar(m1, [huellaDaily(m1)]).vacio).toBe(true);
  });
  it('el comentario dice quién agrega y escapa los datos', () => {
    const a = pendienteDeAgregar(mensaje({ hoy: [item('b', '<b>X</b>')], notas: ['Nota'] }), []);
    const html = cuerpoAgregado(a, 'apertura', 'Grace Franco');
    expect(html).toContain('Agregado por Grace Franco');
    expect(html).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(html).toContain('Nota');
  });
});

const sesion = {
  tipo: 'usuario',
  rol: 'ejecutiva',
  scopes: [],
  nombre: 'Grace Franco',
  perfil: 'sesion',
  ctx: { db: {}, tenantId: 't', usuarioId: 'grace', origen: 'ui' },
} as unknown as AuthInfo;
const app = (auth = sesion) =>
  new Hono()
    .use('*', async (c, next) => {
      c.set('auth', auth);
      await next();
    })
    .route('/semanas', semanas);
const MESA = '40000000-0000-4000-8000-000000000002';
const post = (ruta: string, body: Record<string, unknown>, a = app()) =>
  a.request(`/semanas/daily/${ruta}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mesa_id: MESA, tipo: 'apertura', ...body }),
  });
const publicada = (detalle: Record<string, unknown>) => ({
  accion: 'publicar_daily_apertura',
  created_at: new Date().toISOString(),
  usuario_id: 'caro',
  detalle,
});

describe('publicar sin barreras', () => {
  it('apertura vacía, a cualquier hora y de otra mesa: avisa en la vista previa y un clic publica', async () => {
    m.armar.mockImplementation(async () => mensaje({ hoy: [] }));
    m.publicar.mockResolvedValue({ id: 1, url: 'https://bc/1' });
    const v = (await (await post('vista-previa', {})).json()) as { modo: string; avisos: string[]; avisados: number; html: string };
    expect(v.modo).toBe('publicar');
    expect(v.avisados).toBe(17);
    expect(v.avisos.join(' ')).toContain('Nadie eligió tareas');
    expect(m.publicar).not.toHaveBeenCalled();
    expect((await post('publicar', {})).status).toBe(200);
    expect(m.publicar).toHaveBeenCalledTimes(1);
  });
  it('guarda en la auditoría lo publicado para poder sumar después', async () => {
    m.publicar.mockResolvedValue({ id: 5, url: 'https://bc/5' });
    await post('publicar', {});
    expect(m.audit.mock.calls[0]![1]).toMatchObject({ accion: 'publicar_daily_apertura', detalle: { message_id: 5, ids: ['a'] } });
  });
});

describe('Agregar a la apertura', () => {
  it('comenta en el mismo mensaje con lo nuevo y no crea otro', async () => {
    m.publicaciones = [publicada({ message_id: 77, ids: ['a'], notas: [] })];
    m.armar.mockImplementation(async (_c, _m, _t, notas: string[]) => mensaje({ notas, hoy: [item('a'), item('b')] }));
    m.comentar.mockResolvedValue({ id: 88, url: 'https://bc/77#88' });
    const v = (await (await post('vista-previa', {})).json()) as { modo: string; html: string; nada_nuevo: boolean };
    expect(v.modo).toBe('agregar');
    expect(v.html).toContain('Tarea b');
    expect(v.html).not.toContain('Tarea a');
    const r = await post('publicar', { agregar: true });
    expect(r.status).toBe(200);
    expect(m.comentar.mock.calls[0]![2]).toBe(77);
    expect(m.publicar).not.toHaveBeenCalled();
    expect(m.audit.mock.calls[0]![1]).toMatchObject({ accion: 'agregar_daily_apertura', detalle: { message_id: 77, comment_id: 88 } });
  });
  it('sin nada nuevo no comenta; lo ya agregado no se repite', async () => {
    m.publicaciones = [publicada({ message_id: 77, ids: ['a'], notas: [] })];
    expect((await post('publicar', { agregar: true })).status).toBe(422);
    m.armar.mockImplementation(async () => mensaje({ hoy: [item('a'), item('b')] }));
    m.agregados = [{ accion: 'agregar_daily_apertura', created_at: '', usuario_id: 'grace', detalle: { ids: ['b'], notas: [] } }];
    expect((await post('publicar', { agregar: true })).status).toBe(422);
    expect(m.comentar).not.toHaveBeenCalled();
  });
  it('dos ejecutivas publicando a la vez: sin agregar, la segunda recibe 409 y no duplica', async () => {
    m.publicaciones = [publicada({ message_id: 77, ids: ['a'] })];
    expect((await post('publicar', {})).status).toBe(409);
    expect(m.publicar).not.toHaveBeenCalled();
  });
});

describe('preparación', () => {
  const put = (body: Record<string, unknown>, a = app()) =>
    a.request('/semanas/daily/preparacion', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mesa_id: MESA, tipo: 'apertura', ...body }),
    });
  it('marcar «lista» guarda la fila propia y avisa a las demás solo por la campana', async () => {
    m.clientes = [
      { id: 'c1', activo: true, mesa_id: 'm1', ejecutiva_id: 'caro', nombre: 'A' },
      { id: 'c2', activo: true, mesa_id: 'm1', ejecutiva_id: 'grace', nombre: 'B' },
    ];
    expect((await put({ listo: true })).status).toBe(200);
    expect(m.guardar.mock.calls[0]![1]).toBe('grace');
    expect(m.notificar.mock.calls[0]![2]).toEqual({ usuarioIds: ['caro'] });
    expect(m.notificar.mock.calls[0]![3]).toEqual({ soloCampana: true });
  });
  it('guardar notas no avisa, y marcar «lista» otra vez tampoco', async () => {
    await put({ notas: ['Hola'] });
    m.prep = [fila('grace', ['Hola'], '2026-11-04T15:00:00Z')];
    await put({ listo: true });
    expect(m.notificar).not.toHaveBeenCalled();
  });
  it('una API key no prepara a nombre de nadie', async () => {
    const key = { ...sesion, tipo: 'api_key', ctx: { ...sesion.ctx, usuarioId: null } } as unknown as AuthInfo;
    expect((await put({ notas: ['x'] }, app(key))).status).toBe(403);
  });
});

describe('recordatorio del daily', () => {
  const omega = { id: 'm1', nombre: 'Mesa Omega', activa: true, lider_id: 'julio', basecamp_board_daily_id: 8 };
  it('va a las ejecutivas de la mesa y a su líder', () => {
    expect(
      destinatariosRecordatorio(omega, [
        { mesa_id: 'm1', ejecutiva_id: 'caro' },
        { mesa_id: 'm1', ejecutiva_id: 'caro' },
        { mesa_id: 'otra', ejecutiva_id: 'ana' },
      ]),
    ).toEqual(['caro', 'julio']);
  });
  it('solo si no se publicó, y nunca por correo', async () => {
    m.mesas = [omega];
    m.clientes = [{ id: 'c1', activo: true, mesa_id: 'm1', ejecutiva_id: 'caro', nombre: 'A' }];
    const ctx = { tenantId: 't', usuarioId: null, db: {}, origen: 'cron' } as never;
    expect((await recordarDaily(ctx, 'apertura')).mesas).toBe(1);
    expect(m.notificar.mock.calls[0]![3]).toEqual({ soloCampana: true });
    m.notificar.mockClear();
    m.publicaciones = [publicada({ message_id: 1 })];
    expect((await recordarDaily(ctx, 'apertura')).mesas).toBe(0);
    expect(m.notificar).not.toHaveBeenCalled();
  });
});
