/** La ruta de recuperación de contraseña es pública: debe responder 200 sin Authorization y nunca revelar si el correo existe. */
import { describe, it, expect, vi, beforeAll } from 'vitest';

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
process.env.NODE_ENV = 'test';

vi.mock('../lib/db/client', async (orig) => {
  const mod = await orig<typeof import('../lib/db/client')>();
  const from = () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) });
  return { ...mod, serviceClient: () => ({ from }) as never };
});

let app: import('hono').Hono;
beforeAll(async () => { const { createApp } = await import('../app'); app = createApp(); });

describe('recuperación de contraseña', () => {
  it('responde 200 sin sesión y sin revelar existencia', async () => {
    const res = await app.request('/api/v1/auth/recuperar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'nadie@geeks.com.ec' }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
  it('rechaza correos inválidos', async () => {
    const res = await app.request('/api/v1/auth/recuperar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x' }) });
    expect(res.status).toBe(400);
  });
});
