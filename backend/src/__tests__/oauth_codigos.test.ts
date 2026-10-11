import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

// Base en memoria con lo justo para emitir y canjear un código (oauth_clients, oauth_codes, oauth_tokens).
const tablas = vi.hoisted(() => ({
  oauth_clients: [] as Record<string, unknown>[],
  oauth_codes: [] as Record<string, unknown>[],
  oauth_tokens: [] as Record<string, unknown>[],
}));
vi.mock('../lib/db/client', async (orig) => {
  const mod = await orig<typeof import('../lib/db/client')>();
  const consulta = (tabla: keyof typeof tablas) => {
    const filtros: ((f: Record<string, unknown>) => boolean)[] = [];
    let cambio: Record<string, unknown> | null = null;
    const filas = () => tablas[tabla].filter((f) => filtros.every((c) => c(f)));
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (filtros.push((f) => f[c] === v), q),
      is: (c: string, v: unknown) => (filtros.push((f) => (f[c] ?? null) === v), q),
      update: (u: Record<string, unknown>) => ((cambio = u), q),
      insert: async (f: Record<string, unknown> | Record<string, unknown>[]) => {
        tablas[tabla].push(...(Array.isArray(f) ? f : [f]));
        return { error: null };
      },
      maybeSingle: async () => ({ data: filas()[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown) => {
        const afectadas = filas();
        if (cambio) for (const f of afectadas) Object.assign(f, cambio);
        return Promise.resolve({ data: afectadas, error: null }).then(ok);
      },
    };
    return q;
  };
  return { ...mod, serviceClient: () => ({ from: consulta }) as never };
});

import { canjearCodigo, emitirCodigo } from '../lib/oauth';

const verifier = 'verificador-de-prueba-con-largo-suficiente-para-pkce-0123456789';
const challenge = createHash('sha256').update(verifier).digest('base64url');
const base = {
  client_id: 'cli-1',
  redirect_uri: 'http://localhost:9999/cb',
  code_challenge: challenge,
  scope: ['read:backlog'],
  tenant_id: 't',
  usuario_id: 'u',
};

beforeEach(() => {
  tablas.oauth_clients = [{ id: 'cli-1', secret_hash: null, nombre: 'Agente', redirect_uris: [base.redirect_uri] }];
  tablas.oauth_codes = [];
  tablas.oauth_tokens = [];
});

// M13: el código de autorización se guarda hasheado, como los tokens.
describe('códigos OAuth', () => {
  it('en la base queda el hash, no el código', async () => {
    const code = await emitirCodigo(base);
    expect(tablas.oauth_codes[0]!.code).toBe(createHash('sha256').update(code).digest('hex'));
    expect(JSON.stringify(tablas.oauth_codes)).not.toContain(code);
  });
  it('el código se canjea una sola vez y emite tokens', async () => {
    const code = await emitirCodigo(base);
    const t = await canjearCodigo({ code, client_id: 'cli-1', redirect_uri: base.redirect_uri, code_verifier: verifier });
    expect(t.access_token).toMatch(/^bko_/);
    await expect(canjearCodigo({ code, client_id: 'cli-1', code_verifier: verifier })).rejects.toThrow('invalid_grant');
  });
  it('con el valor guardado (el hash) no se puede canjear', async () => {
    await emitirCodigo(base);
    const guardado = String(tablas.oauth_codes[0]!.code);
    await expect(canjearCodigo({ code: guardado, client_id: 'cli-1', code_verifier: verifier })).rejects.toThrow('invalid_grant');
  });
});
