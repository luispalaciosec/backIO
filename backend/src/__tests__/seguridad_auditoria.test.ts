/**
 * Regresiones de la auditoría de seguridad run-1 (28/09/2026, ~/security-audit-skill/backIO/run-1/NEEDS-VALIDATION.md).
 * Cada test exige el comportamiento seguro; los casos «control» prueban que el arnés funciona y que el 403 no es casual.
 *  #1 oauth-approve-accepts-oauth-access-token
 *  #4 portal-pin-lockout-counter-never-increments
 *  #8 kpis/evolutivo: oauth-token-skips-role-gate
 * Sin Supabase ni red: lib/db, lib/oauth, lib/kpis y lib/evolutivo van mockeados.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
process.env.NODE_ENV = 'test';

const TENANT = '00000000-0000-4000-8000-000000000001';
const USUARIOS: Record<string, { rol: string; nombre: string; activo: boolean; tenant_id: string }> = {
  'u-colab': { rol: 'colaborador', nombre: 'Colaboradora', activo: true, tenant_id: TENANT },
  'u-otra': { rol: 'colaborador', nombre: 'Compañera', activo: true, tenant_id: TENANT },
  'u-lider': { rol: 'lider', nombre: 'Líder', activo: true, tenant_id: TENANT },
};
// Tokens OAuth de prueba → a quién pertenecen y qué scopes tienen.
const TOKENS: Record<string, { usuario_id: string; scopes: string[] }> = {
  bko_colab_lectura: { usuario_id: 'u-colab', scopes: ['read:backlog', 'read:proyectos', 'read:senales', 'read:capacidad'] },
  bko_lider_lectura: { usuario_id: 'u-lider', scopes: ['read:backlog', 'read:capacidad'] },
};

/** Cliente Supabase falso: solo responde la búsqueda de usuarios por id que hace el middleware. */
function fakeDb() {
  let id: string | null = null;
  const q = {
    from: () => q,
    select: () => q,
    eq: (col: string, v: string) => { if (col === 'id') id = v; return q; },
    insert: async () => ({ data: null, error: null }),
    maybeSingle: async () => ({ data: id ? USUARIOS[id] ?? null : null, error: null }),
  };
  return q;
}

vi.mock('../lib/db/client', async (orig) => {
  const mod = await orig<typeof import('../lib/db/client')>();
  return {
    ...mod,
    serviceClient: () => fakeDb() as never,
    // JWT de la UI: 'jwt-lider' es una sesión interactiva del líder.
    userClient: () => Object.assign(fakeDb(), {
      auth: { getUser: async (jwt: string) => (jwt === 'jwt-lider' ? { data: { user: { id: 'u-lider' } }, error: null } : { data: { user: null }, error: new Error('jwt') }) },
    }) as never,
  };
});
vi.mock('../lib/db/audit', () => ({ audit: async () => undefined }));

vi.mock('../lib/oauth', async (orig) => {
  const mod = await orig<typeof import('../lib/oauth')>();
  return {
    ...mod,
    resolverAccessToken: async (t: string) => (TOKENS[t] ? { tenant_id: TENANT, client_id: 'cli-1', ...TOKENS[t] } : null),
    getCliente: async (id: string) => (id === 'cli-1' ? { id, secret_hash: null, nombre: 'Agente de prueba', redirect_uris: ['http://localhost:9999/cb'] } : null),
    emitirCodigo: async () => 'codigo-emitido',
  };
});

vi.mock('../lib/db/proyectos', () => ({
  getProyectoByPortalToken: async (_c: unknown, token: string) =>
    token === 'p'.repeat(43)
      ? {
          proyecto: { id: 'p1', tenant_id: TENANT, nombre: 'Campaña', fecha_entrega: '2099-12-15', cliente_id: 'c1' },
          cliente: { nombre: 'Cliente', logo_url: null, color_primario: '#000', config: { portal_pin: '123456' } },
          requerimientos: [],
        }
      : null,
}));

// Tablero con dos personas: si la respuesta trae a «u-otra», un colaborador vio a su compañera.
vi.mock('../lib/kpis', async (orig) => {
  const mod = await orig<typeof import('../lib/kpis')>();
  const persona = (usuario_id: string) => ({ usuario_id, nombre: USUARIOS[usuario_id]!.nombre, valor: 50, estado: 'no_cumple' });
  return {
    ...mod,
    tableroKpis: async () => ({ periodo: '2026-09', areas: [{ area: 'diseno', kpis: [{ codigo: 'KPI-DIS-01', personas: [persona('u-colab'), persona('u-otra')] }] }], sin_area: [] }),
    detalleKpi: async (_c: unknown, codigo: string, _p: string, usuario?: string) => ({ codigo, usuario }),
    exportarCsv: async () => 'persona,valor\nCompañera,50',
  };
});
vi.mock('../lib/db/mesas', async (orig) => {
  const mod = await orig<typeof import('../lib/db/mesas')>();
  return { ...mod, listMesas: async () => [{ id: 'm1', nombre: 'Orión', activa: true }] };
});
vi.mock('../lib/evolutivo', async (orig) => {
  const mod = await orig<typeof import('../lib/evolutivo')>();
  return { ...mod, evolutivoMes: async () => ({ mes: '2026-09', dias: [{ fecha: '2026-09-25', por_persona: [{ nombre: 'Compañera', planificadas: 3, cerradas: 0 }] }], semanas: [] }) };
});

let app: import('hono').Hono;
beforeAll(async () => {
  const { createApp } = await import('../app');
  app = createApp();
});

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

describe('#1 /oauth/approve solo con sesión humana', () => {
  const body = JSON.stringify({ client_id: 'cli-1', redirect_uri: 'http://localhost:9999/cb', code_challenge: 'x'.repeat(43), scope: 'write:requerimientos write:proyectos write:actas' });
  const approve = (token: string) => app.request('/oauth/approve', { method: 'POST', headers: { ...bearer(token), 'content-type': 'application/json' }, body });

  it('control: la sesión de la UI (JWT) sí puede autorizar', async () => {
    const res = await approve('jwt-lider');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { redirect: string }).redirect).toContain('code=codigo-emitido');
  });

  it('un token OAuth de agente (bko_) no puede autoaprobarse un grant nuevo con más scopes', async () => {
    const res = await approve('bko_lider_lectura');
    expect(res.status).toBe(403);
  });
});

describe('#4 bloqueo del PIN del portal', () => {
  const token = 'p'.repeat(43);
  const intento = (pin: string) => app.request(`/api/portal/${token}`, { headers: { 'x-portal-pin': pin, 'x-forwarded-for': '198.51.100.7' } });

  it('control: el PIN correcto abre el portal', async () => {
    const res = await app.request(`/api/portal/${token}`, { headers: { 'x-portal-pin': '123456', 'x-forwarded-for': '198.51.100.1' } });
    expect(res.status).toBe(200);
  });

  it('tras 8 PIN incorrectos bloquea (429), incluso si el siguiente es el correcto', async () => {
    const estados: number[] = [];
    for (let i = 0; i < 8; i++) estados.push((await intento('000000')).status);
    expect(estados).toEqual(Array(8).fill(401));
    expect((await intento('000000')).status).toBe(429);
    expect((await intento('123456')).status).toBe(429);
  });
});

describe('#8 KPIs y evolutivo por persona: un colaborador no ve a sus pares, tampoco con token OAuth', () => {
  it('control: un líder con token OAuth de lectura sí ve el tablero', async () => {
    expect((await app.request('/api/v1/kpis', { headers: bearer('bko_lider_lectura') })).status).toBe(200);
    expect((await app.request('/api/v1/evolutivo', { headers: bearer('bko_lider_lectura') })).status).toBe(200);
  });

  it('control: el colaborador sí ve su propia ficha en /kpis/mios, sin la compañera', async () => {
    const res = await app.request('/api/v1/kpis/mios', { headers: bearer('bko_colab_lectura') });
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain('u-otra');
  });

  it('GET /kpis (tablero de todos) → 403 para colaborador con bko_', async () => {
    expect((await app.request('/api/v1/kpis', { headers: bearer('bko_colab_lectura') })).status).toBe(403);
  });

  it('GET /kpis/export → 403 para colaborador con bko_', async () => {
    expect((await app.request('/api/v1/kpis/export', { headers: bearer('bko_colab_lectura') })).status).toBe(403);
  });

  it('GET /kpis/:codigo?usuario=<compañera> → 403 para colaborador con bko_', async () => {
    expect((await app.request('/api/v1/kpis/KPI-DIS-01?usuario=u-otra', { headers: bearer('bko_colab_lectura') })).status).toBe(403);
  });

  it('GET /evolutivo (detalle por persona) → 403 para colaborador con bko_', async () => {
    expect((await app.request('/api/v1/evolutivo', { headers: bearer('bko_colab_lectura') })).status).toBe(403);
  });
});
