import { beforeEach, describe, expect, it, vi } from 'vitest';

const e = vi.hoisted(() => ({ persona: null as unknown, tenant: null as unknown, creador: null as string | null }));
vi.mock('../lib/db/credenciales', () => ({
  leerCredencialesPersona: async () => e.persona,
  leerCredencialesBasecamp: async () => e.tenant,
}));
vi.mock('../lib/db/auth', () => ({ creadorDeApiKey: async () => e.creador }));

import { BasecampClient, BasecampSinConectar } from '../lib/basecamp/client';
import { validarIdentidadPersona } from '../lib/basecamp/persona';

const tokens = { access_token: 'a', refresh_token: 'r', expires_at: '2099-01-01T00:00:00Z' };
const dueno = (c: BasecampClient | null) => c && (c as unknown as { usuarioId: string | null }).usuarioId;

beforeEach(() => {
  e.persona = null;
  e.tenant = tokens;
  e.creador = null;
});

// Migración 33: lo que alguien hace desde BackIO sale a su nombre en Basecamp.
describe('qué cuenta de Basecamp se usa', () => {
  it('una persona usa su propia cuenta', async () => {
    e.persona = { ...tokens, email: 'ana@geeks.ec' };
    expect(dueno(await BasecampClient.forActor({ tenantId: 't', usuarioId: 'u1' }))).toBe('u1');
  });
  it('si la persona no conectó su cuenta, no se escribe a nombre de otro', async () => {
    await expect(BasecampClient.forActor({ tenantId: 't', usuarioId: 'u1' })).rejects.toBeInstanceOf(BasecampSinConectar);
    await expect(BasecampClient.forActor({ tenantId: 't', usuarioId: 'u1' })).rejects.toMatchObject({
      status: 428,
      codigo: 'basecamp_sin_conectar',
    });
  });
  it('una API key escribe a nombre de quien la creó', async () => {
    e.persona = { ...tokens, email: 'ana@geeks.ec' };
    e.creador = 'u7';
    expect(dueno(await BasecampClient.forActor({ tenantId: 't', usuarioId: null, apiKeyId: 'k1' }))).toBe('u7');
  });
  it('sin persona no se escribe con la cuenta de otro (19/10/2026)', async () => {
    await expect(BasecampClient.forActor({ tenantId: 't', usuarioId: null })).rejects.toBeInstanceOf(BasecampSinConectar);
    await expect(BasecampClient.forActor({ tenantId: 't', usuarioId: null, apiKeyId: 'k1' })).rejects.toBeInstanceOf(BasecampSinConectar);
  });
});

describe('lo automático con responsable (fee de una ejecutiva, fecha que alguien cambió)', () => {
  it('su cuenta si la conectó; si no, ninguna: no se escribe (nunca con la cuenta de otro)', async () => {
    e.persona = { ...tokens, email: 'ana@geeks.ec' };
    expect(dueno(await BasecampClient.forResponsable('t', 'u1'))).toBe('u1');
    e.persona = null;
    expect(dueno(await BasecampClient.forResponsable('t', 'u1'))).toBeNull();
    expect(dueno(await BasecampClient.forResponsable('t', null))).toBeNull();
  });
});

describe('solo se conecta la cuenta propia', () => {
  const identidad = { id: 501, email_address: 'ana@geeks.ec', first_name: 'Ana', last_name: 'López' };
  it('la persona enlazada en BackIO', () =>
    expect(validarIdentidadPersona({ email: 'otra@geeks.ec', activo: true, basecamp_user_id: 501 }, identidad)).toEqual({
      ok: true,
      enlazar: false,
    }));
  it('la cuenta de otra persona se rechaza', () =>
    expect(validarIdentidadPersona({ email: 'ana@geeks.ec', activo: true, basecamp_user_id: 777 }, identidad)).toMatchObject({
      ok: false,
    }));
  it('sin enlace previo: mismo correo (sin mayúsculas) y se enlaza', () =>
    expect(validarIdentidadPersona({ email: 'Ana@Geeks.ec', activo: true, basecamp_user_id: null }, identidad)).toEqual({
      ok: true,
      enlazar: true,
    }));
  it('sin enlace previo y otro correo: se rechaza', () =>
    expect(validarIdentidadPersona({ email: 'beto@geeks.ec', activo: true, basecamp_user_id: null }, identidad)).toMatchObject({
      ok: false,
    }));
  it('un usuario inactivo no conecta nada', () =>
    expect(validarIdentidadPersona({ email: 'ana@geeks.ec', activo: false, basecamp_user_id: 501 }, identidad)).toMatchObject({
      ok: false,
    }));
});
