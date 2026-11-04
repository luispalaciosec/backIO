import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { RequerimientoMetricas, Usuario } from '@backio/shared';
import { coincideBusqueda } from '@backio/shared';
import type { AuthInfo } from '../lib/auth/middleware';

const m = vi.hoisted(() => {
  process.env.SUPABASE_URL = 'https://prueba.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  return { actualizar: vi.fn() };
});
vi.mock('../lib/requerimientos/actualizar', async (orig) => ({ ...(await orig<object>()), actualizarRequerimiento: m.actualizar }));

const { calcularCargaDia } = await import('../lib/carga');
const { requerimientos } = await import('../routes/v1/requerimientos');
const { ReglaError } = await import('../lib/requerimientos/actualizar');

// docs/05 · Armar el día (4/11/2026).
describe('buscador de los rituales', () => {
  const t = 'REEL 9: Cajero Comisiones Banco Amazonas Óscar Borja';
  it('no importan mayúsculas, tildes ni el orden de las palabras', () => {
    expect(coincideBusqueda('amazonas reel oscar', t)).toBe(true);
    expect(coincideBusqueda('COMISIÓNES', t)).toBe(true);
    expect(coincideBusqueda('  ', t)).toBe(true);
  });
  it('todas las palabras tienen que estar', () => {
    expect(coincideBusqueda('amazonas foligain', t)).toBe(false);
  });
});

const r = (p: Partial<RequerimientoMetricas>) =>
  ({ tipo_pieza_id: null, owner_agencia: [], daily_fecha: null, ...p }) as RequerimientoMetricas;

describe('carga del día', () => {
  const c = calcularCargaDia({
    activos: [
      r({ id: 'a', owner_agencia: ['oscar', 'ana'] }),
      r({ id: 'b', owner_agencia: ['oscar'] }),
      r({ id: 'otra-elegida', owner_agencia: ['oscar'], daily_fecha: '2026-11-04' }),
      r({ id: 'otra-no-elegida', owner_agencia: ['oscar'] }),
    ],
    deLaMesa: new Set(['a', 'b']),
    usuarios: [
      { id: 'oscar', activo: true },
      { id: 'ex', activo: false },
    ] as Usuario[],
    hoy: '2026-11-04',
    estimar: () => ({ horas: 2, base: 'persona' }),
    capacidades: () => ({ horas: 25, base: 'ritmo' }),
    registradas: new Map([['oscar|b', 0.5]]),
  });
  it('horas por tarea y persona de la mesa, descontando lo ya registrado', () => {
    expect(c.horas).toEqual({ a: { oscar: 2, ana: 2 }, b: { oscar: 1.5 } });
  });
  it('un día es la quinta parte de su semana; suma lo elegido hoy en otras mesas, no lo demás', () => {
    expect(c.capacidad_dia).toEqual({ oscar: 5 });
    expect(c.otras_mesas).toEqual({ oscar: 2 });
  });
});

describe('POST /requerimientos/daily-seleccion', () => {
  const app = (rol: string) => {
    const a = new Hono();
    a.use('*', async (c, next) => {
      c.set('auth', {
        tipo: 'usuario',
        rol,
        scopes: [],
        nombre: 'x',
        perfil: 'sesion',
        ctx: { db: {}, tenantId: 't', usuarioId: 'u', origen: 'ui' },
      } as unknown as AuthInfo);
      await next();
    });
    a.route('/requerimientos', requerimientos);
    return a;
  };
  const A = '00000000-0000-4000-8000-00000000000a';
  const B = '00000000-0000-4000-8000-00000000000b';
  const enviar = (rol: string) =>
    app(rol).request('/requerimientos/daily-seleccion', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [A, B], fecha: '2026-11-04' }),
    });

  it('guarda las que puede y devuelve el motivo de las que no (sin responsable)', async () => {
    m.actualizar.mockReset();
    m.actualizar.mockResolvedValueOnce({}).mockRejectedValueOnce(new ReglaError('Sin responsable', 422));
    const res = await enviar('ejecutiva');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ guardadas: [A], errores: [{ id: B, error: 'Sin responsable' }] });
    expect(m.actualizar).toHaveBeenCalledWith(expect.anything(), A, { daily_fecha: '2026-11-04' }, expect.anything());
  });
  it('un colaborador no arma el día (403)', async () => {
    m.actualizar.mockReset();
    expect((await enviar('colaborador')).status).toBe(403);
    expect(m.actualizar).not.toHaveBeenCalled();
  });
});
