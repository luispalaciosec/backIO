import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AuthInfo } from '../lib/auth/middleware';

const m = vi.hoisted(() => {
  process.env.SUPABASE_URL = 'https://prueba.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  return { rentabilidad: vi.fn(async () => ({ mes: '2026-10', clientes: [] })), listCostos: vi.fn(async () => []) };
});
vi.mock('../lib/rentabilidad', async (orig) => ({ ...(await orig<object>()), rentabilidadMes: m.rentabilidad }));
vi.mock('../lib/db/costos', () => ({
  listCostosPersonal: m.listCostos,
  listFeesCliente: async () => [],
  guardarCostoPersonal: vi.fn(),
  guardarFeeCliente: vi.fn(),
}));

const { buscarCliente, calcularRentabilidad, vigente } = await import('../lib/rentabilidad');
const { rentabilidad } = await import('../routes/v1/rentabilidad');

const usuarios = [
  { id: 'ana', nombre: 'Ana', activo: true },
  { id: 'beto', nombre: 'Beto', activo: true },
  { id: 'oscar', nombre: 'Oscar', activo: true },
  { id: 'johanna', nombre: 'Johanna', activo: false, fecha_salida: '2026-09-29' },
];
const clientes = [
  { id: 'tyt', nombre: 'Torres' },
  { id: 'foli', nombre: 'Foligain' },
  { id: 'acme', nombre: 'Acme' },
];

// docs/21 · Rentabilidad (Fase 3 de las mejoras, 30/10/2026).
describe('Rentabilidad por cliente', () => {
  const r = calcularRentabilidad({
    mes: '2026-10',
    costos: [
      { usuario_id: 'ana', sueldo_mensual: 1000, desde: '2026-01-01' },
      { usuario_id: 'ana', sueldo_mensual: 2000, desde: '2026-11-01' }, // todavía no vigente en octubre
      { usuario_id: 'beto', sueldo_mensual: 900, desde: '2026-01-01' },
      { usuario_id: 'oscar', sueldo_mensual: 800, desde: '2026-01-01' },
      { usuario_id: 'johanna', sueldo_mensual: 700, desde: '2026-01-01' },
    ],
    fees: [
      { cliente_id: 'tyt', fee_mensual: 1500, desde: '2026-01-01' },
      { cliente_id: 'foli', fee_mensual: 500, desde: '2026-10-15' },
    ],
    horas: [
      { usuario_id: 'ana', cliente_id: 'tyt', horas: 30 },
      { usuario_id: 'ana', cliente_id: 'foli', horas: 10 },
      { usuario_id: 'beto', cliente_id: 'tyt', horas: 5 },
      { usuario_id: 'beto', cliente_id: 'acme', horas: 5 }, // cliente de prueba: no cuenta
      { usuario_id: null, cliente_id: 'tyt', horas: 3 },
      { usuario_id: 'nuevo', cliente_id: 'foli', horas: 4 }, // sin sueldo cargado
    ],
    usuarios,
    clientes,
    excluir: new Set(['acme']),
  });

  it('reparte el sueldo de cada persona entre sus clientes según sus horas del mes', () => {
    const tyt = r.clientes.find((c) => c.cliente_id === 'tyt')!;
    expect(tyt.costo).toBe(750 + 900); // Ana 30/40 de 1000 + Beto todo (Acme no cuenta)
    expect(tyt.margen).toBe(1500 - 1650);
    expect(tyt.margen_pct).toBe(-10);
    const foli = r.clientes.find((c) => c.cliente_id === 'foli')!;
    expect(foli.costo).toBe(250);
    expect(foli.horas).toBe(14); // las horas de quien no tiene sueldo cuentan, sin costo
    expect(foli.margen).toBe(250);
    expect(r.clientes.map((c) => c.cliente_id)).not.toContain('acme');
  });

  it('muestra aparte el sueldo de quien no registró horas; quien ya salió no cuesta', () => {
    expect(r.sin_repartir.personas.map((p) => p.usuario_id)).toEqual(['oscar']);
    expect(r.sin_repartir.total).toBe(800);
    expect(r.sin_sueldo).toEqual([{ usuario_id: 'nuevo', nombre: 'Sin nombre', horas: 4 }]);
    expect(r.horas_sin_costo).toBe(3);
    expect(r.totales).toEqual({ fee: 2000, costo: 1900, margen: 100 });
  });

  it('el valor vigente es el último con fecha hasta el fin del mes', () => {
    const filas = [
      { desde: '2026-01-01', v: 1 },
      { desde: '2026-10-31', v: 2 },
      { desde: '2026-11-01', v: 3 },
    ];
    expect(vigente(filas, '2026-10-31')?.v).toBe(2);
    expect(vigente(filas, '2025-12-31')).toBeUndefined();
  });
});

// 6/11/2026: C.N. salía con 100 % de margen ($10.450 sin costo) y sus 7 marcas con costo y sin fee.
describe('empresa con varios fees', () => {
  const r = calcularRentabilidad({
    mes: '2026-10',
    costos: [
      { usuario_id: 'ana', sueldo_mensual: 1000, desde: '2026-01-01' },
      { usuario_id: 'beto', sueldo_mensual: 900, desde: '2026-01-01' },
    ],
    fees: [{ cliente_id: 'cn', fee_mensual: 10450, desde: '2026-01-01' }],
    horas: [
      { cliente_id: 'on', usuario_id: 'ana', horas: 30 },
      { cliente_id: 'off', usuario_id: 'ana', horas: 10 },
      { cliente_id: 'off', usuario_id: 'beto', horas: 20 },
      { cliente_id: 'tyt', usuario_id: 'beto', horas: 20 },
    ],
    usuarios,
    clientes: [
      { id: 'cn', nombre: 'Cervecería Nacional C.N.' },
      { id: 'on', nombre: 'TRADE: ON', empresa_id: 'cn' },
      { id: 'off', nombre: 'TRADE: OFF', empresa_id: 'cn' },
      { id: 'tyt', nombre: 'Torres' },
    ],
  });
  it('una sola fila con el fee de la empresa y el costo y las horas de sus marcas', () => {
    const cn = r.clientes.find((c) => c.cliente_id === 'cn')!;
    expect(cn).toMatchObject({ fee: 10450, costo: 1450, horas: 60, margen: 9000, margen_pct: 86 });
    expect(cn.marcas!.map((m) => [m.cliente, m.costo, m.fee])).toEqual([
      ['TRADE: ON', 750, null],
      ['TRADE: OFF', 700, null],
    ]);
    expect(cn.personas.find((p) => p.usuario_id === 'ana')).toMatchObject({ horas: 40, costo: 1000 });
  });
  it('las marcas no salen sueltas y los totales no cambian', () => {
    expect(r.clientes.map((c) => c.cliente_id).sort()).toEqual(['cn', 'tyt']);
    expect(r.totales).toEqual({ fee: 10450, costo: 1900, margen: 8550 });
  });
  it('la ficha de una marca la encuentra dentro de su empresa', () => {
    expect(buscarCliente(r, 'off')?.costo).toBe(700);
  });
});

// 7/11/2026: el sueldo de las ejecutivas quedaba «sin repartir» porque no registran horas.
describe('sueldo de las ejecutivas', () => {
  const base = {
    mes: '2026-10',
    horas: [{ cliente_id: 'a', usuario_id: 'beto', horas: 10 }],
    usuarios: [...usuarios, { id: 'caro', nombre: 'Carolina', activo: true }],
  };
  it('se reparte entre sus cuentas según el fee de cada una', () => {
    const r = calcularRentabilidad({
      ...base,
      costos: [
        { usuario_id: 'caro', sueldo_mensual: 1000, desde: '2026-01-01' },
        { usuario_id: 'beto', sueldo_mensual: 500, desde: '2026-01-01' },
      ],
      fees: [
        { cliente_id: 'a', fee_mensual: 3000, desde: '2026-01-01' },
        { cliente_id: 'b', fee_mensual: 1000, desde: '2026-01-01' },
      ],
      clientes: [
        { id: 'a', nombre: 'A', ejecutiva_id: 'caro' },
        { id: 'b', nombre: 'B', ejecutiva_id: 'caro' },
        { id: 'z', nombre: 'Inactiva', ejecutiva_id: 'caro', activo: false },
      ],
    });
    const a = r.clientes.find((c) => c.cliente_id === 'a')!;
    expect(a.costo).toBe(750 + 500);
    expect(a.personas.find((p) => p.usuario_id === 'caro')).toMatchObject({ costo: 750, horas: 0, reparto: 'cuenta' });
    expect(r.clientes.find((c) => c.cliente_id === 'b')!.costo).toBe(250);
    expect(r.sin_repartir.personas).toEqual([]);
    expect(r.totales.costo).toBe(1500);
  });
  it('una marca sin fee no recibe parte: va a la empresa que cobra por ella', () => {
    const r = calcularRentabilidad({
      ...base,
      horas: [],
      costos: [{ usuario_id: 'caro', sueldo_mensual: 900, desde: '2026-01-01' }],
      fees: [{ cliente_id: 'cn', fee_mensual: 10000, desde: '2026-01-01' }],
      clientes: [
        { id: 'cn', nombre: 'Empresa', ejecutiva_id: 'caro' },
        { id: 'm1', nombre: 'Marca', ejecutiva_id: 'caro', empresa_id: 'cn' },
      ],
    });
    expect(r.clientes.map((c) => [c.cliente_id, c.costo])).toEqual([['cn', 900]]);
  });
  it('sin fees cargados, en partes iguales; sin cuentas, queda sin repartir', () => {
    const r = calcularRentabilidad({
      ...base,
      horas: [],
      costos: [
        { usuario_id: 'caro', sueldo_mensual: 600, desde: '2026-01-01' },
        { usuario_id: 'ana', sueldo_mensual: 400, desde: '2026-01-01' },
      ],
      fees: [],
      clientes: [
        { id: 'a', nombre: 'A', ejecutiva_id: 'caro' },
        { id: 'b', nombre: 'B', ejecutiva_id: 'caro' },
      ],
    });
    expect(r.clientes.map((c) => c.costo)).toEqual([300, 300]);
    expect(r.sin_repartir.personas.map((p) => p.usuario_id)).toEqual(['ana']);
  });
});

describe('Permisos de rentabilidad, sueldos y fees', () => {
  const app = (auth: Partial<AuthInfo>) => {
    const a = new Hono();
    a.use('*', async (c, next) => {
      c.set('auth', { scopes: [], nombre: 'x', ctx: { db: {}, tenantId: 't', usuarioId: 'u', origen: 'ui' }, ...auth } as never);
      await next();
    });
    a.route('/', rentabilidad);
    return a;
  };
  const rutas = ['/rentabilidad', '/rentabilidad/clientes/tyt', '/costos'];

  it.each([
    ['ejecutiva', { tipo: 'usuario', rol: 'ejecutiva', perfil: 'sesion' }],
    ['colaborador', { tipo: 'usuario', rol: 'colaborador', perfil: 'sesion' }],
    ['operaciones', { tipo: 'usuario', rol: 'operaciones', perfil: 'sesion' }],
    ['un agente en nombre de admin', { tipo: 'usuario', rol: 'admin', perfil: 'oauth' }],
    ['una API key con scope admin', { tipo: 'api_key', scopes: ['admin', 'read:proyectos', 'write:proyectos'] }],
  ])('%s recibe 403 y no se consulta nada', async (_, auth) => {
    m.rentabilidad.mockClear();
    m.listCostos.mockClear();
    const a = app(auth as Partial<AuthInfo>);
    for (const r of rutas) expect((await a.request(r)).status).toBe(403);
    const put = await a.request('/costos/sueldos', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usuario_id: '00000000-0000-4000-8000-000000000009', sueldo_mensual: 1000, desde: '2026-10-01' }),
    });
    expect(put.status).toBe(403);
    expect(m.rentabilidad).not.toHaveBeenCalled();
    expect(m.listCostos).not.toHaveBeenCalled();
  });

  it.each(['admin', 'gerencia'])('%s sí la ve', async (rol) => {
    expect((await app({ tipo: 'usuario', rol: rol as never, perfil: 'sesion' }).request('/rentabilidad?mes=2026-10')).status).toBe(200);
  });
});
