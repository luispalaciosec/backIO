/**
 * Auditoría run-1, basecamp-webhook-trusts-payload-state-global-secret: con el secreto único de la URL se podía mandar
 * un evento falso (todo_trashed / todo_completed) y BackIO lo aplicaba sin mirar Basecamp. Ahora el estado se lee del
 * to-do vivo en el proyecto del cliente guardado en BackIO.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
process.env.NODE_ENV = 'test';
process.env.BASECAMP_WEBHOOK_SECRET = 's3cret';

const REQ = { id: 'r1', tenant_id: 't1', cliente_id: 'c1', basecamp_todo_id: 42, estado_operativo: 'en_ejecucion' };
let vivo: Record<string, unknown> | Error = {};
const consultas: [number, number][] = [];
const aplicados: Record<string, unknown>[] = [];

vi.mock('../lib/db/client', async (orig) => {
  const mod = await orig<typeof import('../lib/db/client')>();
  const q = {
    from: () => q,
    select: () => q,
    eq: () => q,
    is: () => q,
    maybeSingle: async () => ({ data: { basecamp_project_id: 100 }, error: null }),
    single: async () => ({ data: { tenant_id: 't1' }, error: null }),
  };
  return { ...mod, serviceClient: () => q as never };
});
vi.mock('../lib/db/audit', () => ({ audit: async () => undefined }));
vi.mock('../lib/db/requerimientos', async (orig) => ({
  ...(await orig<object>()),
  findByBasecampTodo: async (_c: unknown, id: number) => (id === 42 ? REQ : null),
}));
vi.mock('../lib/basecamp/importar', () => ({ importarBasecampCliente: async () => ({}) }));
vi.mock('../lib/basecamp/client', () => ({
  BasecampClient: {
    forTenant: async () => ({
      getTodoRaw: async (p: number, t: number) => {
        consultas.push([p, t]);
        if (vivo instanceof Error) throw vivo;
        return vivo;
      },
    }),
  },
}));
vi.mock('../lib/basecamp/sync', async (orig) => {
  const mod = await orig<typeof import('../lib/basecamp/sync')>();
  return {
    ...mod,
    applyBasecampUpdate: async (_c: unknown, safe: Record<string, unknown>) => {
      aplicados.push(safe);
      return { aplicado: true, requerimiento_id: 'r1' };
    },
  };
});

let app: import('hono').Hono;
beforeAll(async () => {
  const { createApp } = await import('../app');
  app = createApp();
});
beforeEach(() => {
  consultas.length = 0;
  aplicados.length = 0;
});

const evento = (kind: string, bucket = 100) =>
  app.request('/api/webhooks/basecamp/s3cret', {
    method: 'POST',
    body: JSON.stringify({ kind, recording: { id: 42, bucket: { id: bucket } } }),
  });
const todoVivo = (p: Record<string, unknown>) => ({ id: 42, bucket: { id: 100 }, completed: false, status: 'active', ...p });

describe('webhook de Basecamp: el estado sale del to-do vivo', () => {
  it('control: un todo_completed real se aplica como completado', async () => {
    vivo = todoVivo({ completed: true });
    expect((await evento('todo_completed')).status).toBe(200);
    expect(consultas).toEqual([[100, 42]]);
    expect(aplicados[0]).toMatchObject({ completed: true });
  });

  it('control: una tarea enviada de verdad a la papelera se cancela', async () => {
    vivo = todoVivo({ status: 'trashed' });
    await evento('todo_trashed');
    expect(aplicados[0]).toMatchObject({ eliminado: true });
  });

  it('un todo_trashed falso sobre un to-do activo NO cancela la tarea', async () => {
    vivo = todoVivo({});
    await evento('todo_trashed');
    expect(aplicados[0]).toMatchObject({ completed: false });
    expect(aplicados[0]?.eliminado).toBeUndefined();
  });

  it('un todo_completed falso sobre un to-do abierto NO la completa', async () => {
    vivo = todoVivo({ completed: false });
    await evento('todo_completed');
    expect(aplicados[0]).toMatchObject({ completed: false });
  });

  it('un evento con el bucket de otro proyecto no se aplica ni consulta Basecamp', async () => {
    vivo = todoVivo({ completed: true });
    const res = await evento('todo_completed', 999);
    expect(await res.text()).toContain('no verificado');
    expect(consultas).toEqual([]);
    expect(aplicados).toEqual([]);
  });

  it('si Basecamp no responde, no se aplica nada y se pide reintento', async () => {
    vivo = new Error('Basecamp 500 GET /buckets/100/todos/42.json: error');
    expect((await evento('todo_completed')).status).toBe(503);
    expect(aplicados).toEqual([]);
  });
});
