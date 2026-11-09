import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const m = vi.hoisted(() => {
  process.env.SUPABASE_URL = 'https://prueba.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  process.env.BASECAMP_WEBHOOK_SECRET = 'secreto';
  return { find: vi.fn() };
});
vi.mock('../lib/db/requerimientos', async (orig) => ({ ...(await orig<object>()), findByBasecampTodo: m.find }));
vi.mock('../lib/basecamp/sync', async (orig) => ({
  ...(await orig<object>()),
  extractSafePayload: () => ({ todo_id: 1, bucket_id: 2 }),
}));

const { BaseNoDisponible, esFallaDeBase, lanzarSiBaseCaida, throwIf } = await import('../lib/db/client');
const { basecampWebhook, reiniciarPausaWebhook } = await import('../routes/webhooks/basecamp');

// 9/11/2026: con la base caída, BackIO decía «Credenciales inválidas» y los webhooks seguían insistiendo.
describe('cuando la base no responde', () => {
  it('reconoce la caída y no la confunde con «no existe»', () => {
    expect(esFallaDeBase({ code: 'PGRST002', message: 'schema cache' })).toBe(true);
    expect(esFallaDeBase({ message: 'Timed out acquiring connection' })).toBe(true);
    expect(esFallaDeBase({ code: 'PGRST116', message: 'no rows' }, 406)).toBe(false);
    expect(esFallaDeBase(null)).toBe(false);
    expect(() => lanzarSiBaseCaida({ code: 'PGRST003', message: 'x' })).toThrow(BaseNoDisponible);
    expect(() => lanzarSiBaseCaida({ message: 'JWT expired', status: 401 })).not.toThrow();
  });
  it('throwIf da 503 con un mensaje claro', () => {
    try {
      throwIf({ code: 'PGRST002', message: 'x' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(BaseNoDisponible);
      expect((e as InstanceType<typeof BaseNoDisponible>).status).toBe(503);
    }
  });
});

describe('webhook de Basecamp con la base caída', () => {
  const app = new Hono().route('/w', basecampWebhook);
  const enviar = () => app.request('/w/secreto', { method: 'POST', body: JSON.stringify({ kind: 'todo_changed' }) });
  beforeEach(() => {
    reiniciarPausaWebhook();
    m.find.mockReset();
  });
  it('responde 503 para que Basecamp reintente, y deja de golpear la base por 30 s', async () => {
    m.find.mockRejectedValue(new BaseNoDisponible());
    expect((await enviar()).status).toBe(503);
    expect((await enviar()).status).toBe(503);
    expect(m.find).toHaveBeenCalledTimes(1);
  });
});
