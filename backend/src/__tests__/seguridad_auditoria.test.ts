/**
 * Regresiones de la auditoría de seguridad run-1 (28/09/2026, ~/security-audit-skill/backIO/run-1/NEEDS-VALIDATION.md).
 * Cada test exige el comportamiento seguro; los casos «control» prueban que el arnés funciona y que el 403 no es casual.
 *  #1 oauth-approve-accepts-oauth-access-token
 *  #4 portal-pin-lockout-counter-never-increments
 *  #8 kpis/evolutivo: oauth-token-skips-role-gate
 *  #2 frontend/oauth-consent/denegar-unvalidated-redirect-uri (el servidor valida el retorno de «Denegar»)
 *  #3 oauth-dcr-redirect-uri-scheme-not-restricted
 * Sin Supabase ni red: lib/db, lib/oauth, lib/kpis y lib/evolutivo van mockeados.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createHash, createHmac } from 'node:crypto';

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
process.env.NODE_ENV = 'test';
process.env.PROMETIO_WEBHOOK_SECRET = 'secreto-prometio'; // env() se cachea: debe estar antes de crear la app

const TENANT = '00000000-0000-4000-8000-000000000001';
const USUARIOS: Record<string, { rol: string; nombre: string; activo: boolean; tenant_id: string }> = {
  'u-colab': { rol: 'colaborador', nombre: 'Colaboradora', activo: true, tenant_id: TENANT },
  'u-otra': { rol: 'colaborador', nombre: 'Compañera', activo: true, tenant_id: TENANT },
  'u-lider': { rol: 'lider', nombre: 'Líder', activo: true, tenant_id: TENANT },
  'u-admin': { rol: 'admin', nombre: 'Admin', activo: true, tenant_id: TENANT },
};
const KEY_ADMIN = 'bk_admin_prueba';
// Tokens OAuth de prueba → a quién pertenecen y qué scopes tienen.
const TOKENS: Record<string, { usuario_id: string; scopes: string[] }> = {
  bko_colab_lectura: { usuario_id: 'u-colab', scopes: ['read:backlog', 'read:proyectos', 'read:senales', 'read:capacidad'] },
  bko_lider_lectura: { usuario_id: 'u-lider', scopes: ['read:backlog', 'read:capacidad'] },
};

/**
 * Cliente Supabase falso: responde la búsqueda de usuarios por id, la API key de admin de prueba, el tenant por defecto
 * y los insert/update encadenados. Todo lo demás devuelve vacío.
 */
function fakeDb() {
  let tabla = ''; let id: string | null = null; let hash: string | null = null;
  const q = {
    from: (t: string) => { tabla = t; return q; },
    select: () => q, order: () => q, limit: () => q, is: () => q, in: () => q, update: () => q, insert: () => q, upsert: () => q,
    eq: (col: string, v: string) => { if (col === 'id') id = v; if (col === 'key_hash') hash = v; return q; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res, rej),
    single: async () => ({ data: tabla === 'tenants' ? { id: TENANT } : tabla === 'api_keys' ? { id: 'k-nueva', nombre: 'nueva', prefijo: 'bk_live_xxxx', scopes: [], perfil: 'custom' } : null, error: null }),
    maybeSingle: async () => {
      if (tabla === 'api_keys') return { data: hash === createHash('sha256').update(KEY_ADMIN).digest('hex') ? { id: 'k-admin', tenant_id: TENANT, nombre: 'Key admin', scopes: ['admin'], perfil: 'custom', revocada_at: null } : null, error: null };
      return { data: id ? USUARIOS[id] ?? null : null, error: null };
    },
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
      auth: { getUser: async (jwt: string) => ({ 'jwt-lider': 'u-lider', 'jwt-admin': 'u-admin' } as Record<string, string>)[jwt] ? { data: { user: { id: ({ 'jwt-lider': 'u-lider', 'jwt-admin': 'u-admin' } as Record<string, string>)[jwt] } }, error: null } : { data: { user: null }, error: new Error('jwt') } },
    }) as never,
  };
});
vi.mock('../lib/db/audit', () => ({ audit: async () => undefined }));

vi.mock('../lib/oauth', async (orig) => {
  const mod = await orig<typeof import('../lib/oauth')>();
  return {
    ...mod,
    resolverAccessToken: async (t: string) => (TOKENS[t] ? { tenant_id: TENANT, client_id: 'cli-1', ...TOKENS[t] } : null),
    getCliente: async (id: string) =>
      id === 'cli-1' ? { id, secret_hash: null, nombre: 'Agente de prueba', redirect_uris: ['http://localhost:9999/cb'] }
      // Cliente registrado antes del arreglo con un esquema peligroso guardado.
      : id === 'cli-malo' ? { id, secret_hash: null, nombre: 'Claude', redirect_uris: ['javascript://localhost/%0aalert(1)//'] }
      : null,
    emitirCodigo: async () => 'codigo-emitido',
  };
});

vi.mock('../lib/db/proyectos', () => ({
  getProyectoByPortalToken: async (_c: unknown, token: string) =>
    token === 't'.repeat(43)
      ? { proyecto: { id: 'p2', tenant_id: TENANT, nombre: 'Campaña', fecha_entrega: '2099-12-15', cliente_id: 'c-hash' }, cliente: { nombre: 'Cliente', logo_url: null, color_primario: '#000', config: {} }, requerimientos: [] }
    : /^[pqrs]{43}$/.test(token)
      ? {
          proyecto: { id: 'p1', tenant_id: TENANT, nombre: 'Campaña', fecha_entrega: '2099-12-15', cliente_id: 'c1' },
          cliente: { nombre: 'Cliente', logo_url: null, color_primario: '#000', config: { portal_pin: '123456' } },
          requerimientos: [],
        }
      : null,
}));

// Tablero con dos personas: si la respuesta trae a «u-otra», un colaborador vio a su compañera.
vi.mock('../lib/portal/resumen', () => ({ generarResumen: async () => { throw new Error('ANTHROPIC_API_KEY no configurada'); } }));
vi.mock('../lib/personas', async (orig) => ({ ...(await orig<object>()), resumenPersonas: async () => ({ periodo: 'semana', personas: [{ usuario_id: 'u-colab', nombre: 'Colaboradora', email: 'colab@geeks.com.ec', puntaje: 70 }, { usuario_id: 'u-otra', nombre: 'Compañera', email: 'otra@geeks.com.ec', puntaje: 40 }] }) }));
vi.mock('../lib/horas', async (orig) => ({ ...(await orig<object>()), resumenHoras: async () => ({ por_cliente: {}, por_usuario: { 'u-colab': 5, 'u-otra': 7 }, por_requerimiento: { r1: 3 }, por_proyecto: {}, total: 12 }) }));
vi.mock('../lib/portal/pin', async (orig) => {
  const mod = await orig<typeof import('../lib/portal/pin')>();
  const hash = mod.hashPin('4321');
  return { ...mod, leerHashPin: async (clienteId: string) => (clienteId === 'c-hash' ? hash : null) };
});
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

describe('#3 registro dinámico: redirect_uri solo https o http en loopback', () => {
  const registrar = (redirect_uris: string[]) => app.request('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'X', redirect_uris }) });

  it('control: https y http://localhost se aceptan', async () => {
    expect((await registrar(['https://claude.ai/api/mcp/auth_callback'])).status).toBe(201);
    expect((await registrar(['http://localhost:6274/oauth/callback'])).status).toBe(201);
  });

  it.each(['javascript://localhost/%0aalert(1)//', 'data://localhost/x', 'http://evil.example/cb', 'vbscript://127.0.0.1/x'])('rechaza %s', async (u) => {
    expect((await registrar([u])).status).toBe(400);
  });

  it('/oauth/approve no devuelve un esquema peligroso ya guardado en un cliente viejo', async () => {
    const res = await app.request('/oauth/approve', { method: 'POST', headers: { ...bearer('jwt-lider'), 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: 'cli-malo', redirect_uri: 'javascript://localhost/%0aalert(1)//', code_challenge: 'x'.repeat(43) }) });
    expect(res.status).toBe(400);
  });
});

describe('#2 «Denegar» del consentimiento: el retorno lo valida el servidor', () => {
  const denegar = (client_id: string, redirect_uri: string) => app.request('/oauth/deny', { method: 'POST', headers: { ...bearer('jwt-lider'), 'content-type': 'application/json' },
    body: JSON.stringify({ client_id, redirect_uri, state: 'st' }) });

  it('control: con la URI registrada devuelve el retorno con access_denied', async () => {
    const res = await denegar('cli-1', 'http://localhost:9999/cb');
    expect(res.status).toBe(200);
    const { redirect } = (await res.json()) as { redirect: string };
    expect(redirect).toBe('http://localhost:9999/cb?error=access_denied&state=st');
  });

  it.each([
    ['cli-1', 'javascript:alert(document.cookie)//'],
    ['cli-1', 'https://evil.example/'],
    ['cli-malo', 'javascript://localhost/%0aalert(1)//'],
    ['no-existe', 'http://localhost:9999/cb'],
  ])('rechaza %s → %s', async (id, uri) => {
    expect((await denegar(id, uri)).status).toBe(400);
  });

  it('exige sesión', async () => {
    const res = await app.request('/oauth/deny', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: 'cli-1', redirect_uri: 'http://localhost:9999/cb' }) });
    expect(res.status).toBe(401);
  });
});

describe('#17 bloqueo del PIN: la IP la pone el proxy y hay tope por token', () => {
  const intento = (token: string, xff: string, pin = '000000') => app.request(`/api/portal/${token}`, { headers: { 'x-portal-pin': pin, 'x-forwarded-for': xff } });

  it('cambiar la primera entrada de X-Forwarded-For no da un contador nuevo (cuenta la que agrega el proxy)', async () => {
    const q = 'q'.repeat(43);
    for (let i = 0; i < 8; i++) expect((await intento(q, `10.0.0.${i}, 203.0.113.9`)).status).toBe(401);
    expect((await intento(q, '10.0.0.99, 203.0.113.9')).status).toBe(429);
  });

  it('aunque cambie la IP en cada intento, a los 30 fallos el token queda bloqueado', async () => {
    const r = 'r'.repeat(43);
    for (let i = 0; i < 30; i++) expect((await intento(r, `198.18.0.${i}`)).status).toBe(401);
    expect((await intento(r, '198.18.1.1', '123456')).status).toBe(429);
  });
});

describe('#13 las API keys solo las crea una persona admin', () => {
  const crear = (token: string) => app.request('/api/v1/admin/api-keys', { method: 'POST', headers: { ...bearer(token), 'content-type': 'application/json' }, body: JSON.stringify({ nombre: 'otra', perfil: 'custom', scopes: ['admin'] }) });

  it('control: un admin con su sesión la crea', async () => {
    expect((await crear('jwt-admin')).status).toBe(201);
  });

  it('una API key con scope admin no puede crear otra key (quedaría sin dueño)', async () => {
    expect((await crear(KEY_ADMIN)).status).toBe(403);
  });
});

describe('#18 webhook de PrometIO: timestamp firmado obligatorio', () => {
  const firmar = (body: string) => `sha256=${createHmac('sha256', 'secreto-prometio').update(body).digest('hex')}`;
  const enviar = (cuerpo: object) => { const body = JSON.stringify(cuerpo); return app.request('/api/v1/webhooks/prometio', { method: 'POST', headers: { 'content-type': 'application/json', 'x-prometio-signature': firmar(body) }, body }); };

  it('control: un envío firmado y reciente se procesa', async () => {
    const res = await enviar({ evento: 'evento.desconocido', timestamp: new Date().toISOString(), data: { n: 1 } });
    expect(res.status).not.toBe(401);
  });

  it('sin timestamp en el cuerpo se rechaza', async () => {
    expect((await enviar({ evento: 'empresa.actualizada', data: { n: 2 } })).status).toBe(401);
  });

  it('un envío firmado viejo (repetido más tarde) se rechaza', async () => {
    expect((await enviar({ evento: 'empresa.actualizada', timestamp: new Date(Date.now() - 60 * 60_000).toISOString(), data: { n: 3 } })).status).toBe(401);
  });
});

describe('Ola 0 (auditoría 10/10)', () => {
  it('B1 · el preflight CORS de /api permite PUT (guardar plantillas, tipos de pieza y KPIs)', async () => {
    const res = await app.request('/api/v1/plantillas', { method: 'OPTIONS', headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'PUT', 'access-control-request-headers': 'authorization,content-type' } });
    expect(res.headers.get('access-control-allow-methods') ?? '').toContain('PUT');
  });

  it('S13 · el resumen del portal no expone el error interno al visitante', async () => {
    const res = await app.request(`/api/portal/${'s'.repeat(43)}/resumen`, { method: 'POST', headers: { 'x-portal-pin': '123456', 'x-forwarded-for': '192.0.2.50' } });
    expect(res.status).toBe(503);
    const cuerpo = await res.text();
    expect(cuerpo).not.toContain('ANTHROPIC');
    expect(cuerpo).toContain('no está disponible');
  });
});

describe('Ola 1a (auditoría 10/10)', () => {
  it('S1 · el log de peticiones no guarda el secreto del webhook ni el token del portal', async () => {
    const { redactarRuta } = await import('../lib/log');
    expect(redactarRuta('/api/webhooks/basecamp/s3cr3t-largo')).toBe('/api/webhooks/basecamp/[redactado]');
    expect(redactarRuta('/api/portal/abc123token/resumen')).toBe('/api/portal/[redactado]/resumen');
    expect(redactarRuta('/api/basecamp/oauth/callback?code=xyz&state=abc')).toBe('/api/basecamp/oauth/callback');
    expect(redactarRuta('/api/v1/backlog')).toBe('/api/v1/backlog');
  });

  it('S3 · un colaborador solo ve su fila de Personas y sin correo; gestión ve a todos', async () => {
    const colab = (await (await app.request('/api/v1/personas', { headers: bearer('bko_colab_lectura') })).json()) as { personas: Record<string, unknown>[] };
    expect(colab.personas.map((p) => p.usuario_id)).toEqual(['u-colab']);
    expect(colab.personas[0]).not.toHaveProperty('email');
    const lider = (await (await app.request('/api/v1/personas', { headers: bearer('bko_lider_lectura') })).json()) as { personas: unknown[] };
    expect(lider.personas).toHaveLength(2);
  });

  it('S3 · en el resumen de horas un colaborador solo ve sus horas por persona', async () => {
    const r = (await (await app.request('/api/v1/horas/resumen', { headers: bearer('bko_colab_lectura') })).json()) as { por_usuario: Record<string, number>; por_requerimiento: Record<string, number> };
    expect(r.por_usuario).toEqual({ 'u-colab': 5 });
    expect(r.por_requerimiento).toEqual({ r1: 3 });
  });

  it('S5 · la ruta del botón del correo: solo la última marca y solo secciones de BackIO', async () => {
    const { separarRuta, rutaPermitida } = await import('../lib/notificaciones');
    expect(separarRuta('Señales\n• Tarea X\n__ruta__:/oauth/consent?client_id=evil\n__ruta__:/weekly')).toEqual({ cuerpo: 'Señales\n• Tarea X\n__ruta__:/oauth/consent?client_id=evil', ruta: '/weekly' });
    expect(rutaPermitida('/oauth/consent?client_id=x')).toBeUndefined();
    expect(rutaPermitida('//evil.example')).toBeUndefined();
    expect(rutaPermitida('/proyectos/123')).toBe('/proyectos/123');
    expect(rutaPermitida('/admin/api-keys')).toBe('/admin/api-keys');
  });

  it('S5 · un título con saltos de línea se rechaza', async () => {
    const res = await app.request('/api/v1/requerimientos', { method: 'POST', headers: { ...bearer('jwt-lider'), 'content-type': 'application/json' },
      body: JSON.stringify({ cliente_id: '00000000-0000-4000-8000-0000000000aa', titulo_interno: 'Tarea\n__ruta__:/oauth/consent' }) });
    expect(res.status).toBe(400);
  });

  it('S6 · la pantalla de consentimiento obtiene nombre y hosts del registro, no de la URL', async () => {
    const r = (await (await app.request('/oauth/client/cli-1?scope=read:backlog%20admin')).json()) as { nombre: string; hosts: string[]; scopes: string[] };
    expect(r).toEqual({ client_id: 'cli-1', nombre: 'Agente de prueba', hosts: ['localhost:9999'], scopes: ['read:backlog'] });
    expect((await app.request('/oauth/client/no-existe')).status).toBe(404);
  });

  it('S6 · el registro dinámico valida el esquema (nombre de una línea, límites)', async () => {
    const registrar = (b: object) => app.request('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    expect((await registrar({ client_name: 'Claude\nDesktop', redirect_uris: ['https://claude.ai/cb'] })).status).toBe(400);
    expect((await registrar({ client_name: 'X', redirect_uris: Array(11).fill('https://claude.ai/cb') })).status).toBe(400);
    expect((await registrar({ client_name: 'Claude', redirect_uris: ['https://claude.ai/cb'] })).status).toBe(201);
  });

  it('punto 13 · GET /plantillas?cliente= exige un uuid', async () => {
    expect((await app.request('/api/v1/plantillas?cliente=x),id.neq.null', { headers: bearer('jwt-lider') })).status).toBe(400);
  });

  it('punto 14 · un cuerpo de más de 1 MB se rechaza con 413', async () => {
    const res = await app.request('/api/v1/requerimientos', { method: 'POST', headers: { ...bearer('jwt-lider'), 'content-type': 'application/json', 'content-length': String(2 * 1024 * 1024) }, body: 'x'.repeat(2 * 1024 * 1024) });
    expect(res.status).toBe(413);
  });
});

describe('Ola 1b (auditoría 10/10)', () => {
  it('M3 · el PIN se guarda con hash y sal: no es reversible y dos hashes del mismo PIN difieren', async () => {
    const { hashPin, pinCoincide } = await import('../lib/portal/pin');
    const a = hashPin('123456'), b = hashPin('123456');
    expect(a).not.toContain('123456');
    expect(a).not.toBe(b);
    expect(pinCoincide('123456', a)).toBe(true);
    expect(pinCoincide('123457', a)).toBe(false);
    expect(pinCoincide('123456', 'basura')).toBe(false);
  });

  it('M3 · el portal valida el PIN contra el hash guardado', async () => {
    const pedir = (pin?: string) => app.request(`/api/portal/${'t'.repeat(43)}`, { headers: { 'x-forwarded-for': '192.0.2.77', ...(pin ? { 'x-portal-pin': pin } : {}) } });
    expect((await pedir()).status).toBe(401);
    expect((await pedir('0000')).status).toBe(401);
    expect((await pedir('4321')).status).toBe(200);
  });

  it('S11 · una key de perfil cliente exige el cliente al que pertenece', async () => {
    const res = await app.request('/api/v1/admin/api-keys', { method: 'POST', headers: { ...bearer('jwt-admin'), 'content-type': 'application/json' }, body: JSON.stringify({ nombre: 'Portal cliente', perfil: 'cliente' }) });
    expect(res.status).toBe(400);
  });
});

describe('Ola 2 · dependencias', () => {
  it('el servidor MCP responde initialize y lista tools con el SDK actualizado', async () => {
    const h = { ...bearer('bko_lider_lectura'), 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    const init = await app.request('/mcp', { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) });
    expect(init.status).toBe(200);
    expect(await init.text()).toContain('backio');
    const tools = await app.request('/mcp', { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) });
    expect(tools.status).toBe(200);
    expect(await tools.text()).toContain('confirm_plan');
  });
});

describe('Ola 3 (auditoría 10/10)', () => {
  it('punto 11 · el registro dinámico OAuth se limita a 10 por hora por IP', async () => {
    const registrar = () => app.request('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.99' }, body: JSON.stringify({ client_name: 'X', redirect_uris: ['https://claude.ai/cb'] }) });
    for (let i = 0; i < 10; i++) expect((await registrar()).status).toBe(201);
    const bloqueado = await registrar();
    expect(bloqueado.status).toBe(429);
    expect(Number(bloqueado.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('punto 11 · recuperar contraseña: 10 por IP cada 15 minutos', async () => {
    const pedir = () => app.request('/api/v1/auth/recuperar', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.120' }, body: JSON.stringify({ email: 'nadie@example.com' }) });
    for (let i = 0; i < 10; i++) expect((await pedir()).status).toBe(200);
    expect((await pedir()).status).toBe(429);
  });

  it('punto 12 · Turnstile: sin clave no se exige; con clave, sin token se rechaza', async () => {
    const { verificarTurnstile } = await import('../lib/turnstile');
    expect(await verificarTurnstile(undefined)).toBe(true);
    process.env.TURNSTILE_SECRET_KEY = 'prueba';
    try { expect(await verificarTurnstile(undefined)).toBe(false); }
    finally { delete process.env.TURNSTILE_SECRET_KEY; }
  });

  it('punto 18 · la API responde con CSP que no permite cargar nada ni ser embebida', async () => {
    const res = await app.request('/health');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });
});
