import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const m = vi.hoisted(() => ({
  req: null as Record<string, unknown> | null,
  planes: new Map<string, { tool: string; parametros: unknown; usuario_id: string | null; api_key_id: string | null }>(),
  actualizar: vi.fn(),
  validar: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('../lib/db/requerimientos', async (orig) => ({ ...(await orig<object>()), getRequerimiento: async () => m.req }));
vi.mock('../lib/db/usuarios', async (orig) => ({ ...(await orig<object>()), listUsuarios: async () => [{ id: 'u1', nombre: 'Ana' }] }));
vi.mock('../lib/db/audit', () => ({ audit: m.audit }));
vi.mock('../lib/mcp/plans', () => ({
  guardarPlan: async (_c: unknown, tool: string, parametros: unknown) => {
    const id = `plan_${'a'.repeat(11)}${m.planes.size}`;
    m.planes.set(id, { tool, parametros, usuario_id: 'admin', api_key_id: null });
    return { plan_id: id, expira_en: 'pronto' };
  },
  verPlan: async (_c: unknown, id: string) => m.planes.get(id) ?? null,
  tomarPlan: async (_c: unknown, id: string) => m.planes.get(id)!,
  guardarResultado: async () => undefined,
}));
vi.mock('../lib/requerimientos/actualizar', async (orig) => {
  const real = await orig<typeof import('../lib/requerimientos/actualizar')>();
  m.validar.mockImplementation(real.validarActualizacion);
  return {
    ...real,
    actualizarRequerimiento: m.actualizar,
    validarActualizacion: (...a: Parameters<typeof real.validarActualizacion>) => m.validar(...a),
  };
});

import { buildMcpServer } from '../lib/mcp/server';
import { ReglaError } from '../lib/requerimientos/actualizar';

const auth = {
  tipo: 'usuario',
  rol: 'operaciones',
  perfil: 'sesion',
  scopes: [],
  ctx: { db: {}, tenantId: 't', usuarioId: 'admin', origen: 'ui' },
} as never;
async function cliente() {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await buildMcpServer(auth).connect(a);
  const c = new Client({ name: 'prueba', version: '1' });
  await c.connect(b);
  return c;
}
const texto = (r: { content: unknown }) => JSON.parse((r.content as { text: string }[])[0]!.text) as Record<string, unknown>;

beforeEach(() => {
  m.req = {
    id: 'r1',
    titulo_interno: 'Post',
    owner_agencia: [],
    fecha_entrega: '2026-10-10',
    basecamp_todo_id: 9,
    estado_aprobacion: 'pendiente_interno',
    estado_operativo: 'priorizado',
  };
  m.planes.clear();
  m.actualizar.mockReset().mockResolvedValue({ requerimiento: {}, basecamp_due_on: 'ok' });
});

// Ola 8 (B9): el agente sigue las mismas reglas que la pantalla de backlog, en el preview y al confirmar.
describe('MCP: actualizar requerimiento', () => {
  it('cambiar la fecha sin motivo no genera plan', async () => {
    const c = await cliente();
    const r = await c.callTool({
      name: 'plan_requirement_update',
      arguments: { requerimiento_id: '00000000-0000-4000-8000-000000000001', cambios: { fecha_entrega: '2026-10-20' } },
    });
    expect(r.isError).toBe(true);
    expect(m.planes.size).toBe(0);
  });
  it('el preview pasa por las reglas comunes: si no se podrá aplicar, no hay plan', async () => {
    const c = await cliente();
    m.validar.mockImplementationOnce(() => {
      throw new ReglaError('Esta tarea se marca como completada en Basecamp.', 422);
    });
    const r = await c.callTool({
      name: 'plan_requirement_update',
      arguments: { requerimiento_id: '00000000-0000-4000-8000-000000000001', cambios: { prioridad: 'alta' } },
    });
    expect(r.isError).toBe(true);
    expect(texto(r)).toEqual({ error: 'Esta tarea se marca como completada en Basecamp.' });
    expect(m.validar).toHaveBeenCalledWith(expect.anything(), m.req, { prioridad: 'alta' }, { colaborador: false, exigirMotivo: true });
    expect(m.planes.size).toBe(0);
  });
  it('confirmar aplica con actualizarRequerimiento, exige motivo y audita el plan_id', async () => {
    const c = await cliente();
    const plan = texto(
      await c.callTool({
        name: 'plan_requirement_update',
        arguments: {
          requerimiento_id: '00000000-0000-4000-8000-000000000001',
          cambios: { fecha_entrega: '2026-10-20', motivo_reprogramacion: 'cambio_alcance' },
        },
      }),
    );
    const r = texto(await c.callTool({ name: 'confirm_plan', arguments: { plan_id: plan.plan_id as string } }));
    expect(r).toMatchObject({ ok: true, basecamp_due_on: 'ok' });
    expect(m.actualizar).toHaveBeenCalledWith(
      expect.objectContaining({ origen: 'mcp' }),
      '00000000-0000-4000-8000-000000000001',
      { fecha_entrega: '2026-10-20', motivo_reprogramacion: 'cambio_alcance' },
      expect.objectContaining({ exigirMotivo: true, colaborador: false, auditoriaExtra: { plan_id: plan.plan_id } }),
    );
  });
  it('si la regla cambió entre el preview y la confirmación, el agente recibe el motivo', async () => {
    const c = await cliente();
    const plan = texto(
      await c.callTool({
        name: 'plan_requirement_update',
        arguments: { requerimiento_id: '00000000-0000-4000-8000-000000000001', cambios: { prioridad: 'alta' } },
      }),
    );
    m.actualizar.mockRejectedValueOnce(new ReglaError('Esta tarea se marca como completada en Basecamp.', 422));
    const r = await c.callTool({ name: 'confirm_plan', arguments: { plan_id: plan.plan_id as string } });
    expect(r.isError).toBe(true);
    expect(texto(r)).toEqual({ error: 'Esta tarea se marca como completada en Basecamp.' });
  });
});
