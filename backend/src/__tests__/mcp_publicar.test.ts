import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const m = vi.hoisted(() => ({
  acta: null as Record<string, unknown> | null,
  planes: new Map<string, { tool: string; parametros: unknown; usuario_id: string | null; api_key_id: string | null }>(),
  publicar: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('../lib/db/semanas', async (orig) => ({ ...(await orig<object>()), getActa: async () => m.acta }));
vi.mock('../lib/db/mesas', async (orig) => ({ ...(await orig<object>()), listMesas: async () => [{ id: 'm1', nombre: 'Mesa Orión' }] }));
vi.mock('../lib/db/audit', () => ({ audit: m.audit }));
vi.mock('../lib/mcp/publish', () => ({ publicarActaEnBasecamp: m.publicar }));
vi.mock('../lib/mcp/plans', () => ({
  guardarPlan: async (_c: unknown, tool: string, parametros: unknown) => {
    const id = `plan_${'b'.repeat(11)}${m.planes.size}`;
    m.planes.set(id, { tool, parametros, usuario_id: 'admin', api_key_id: null });
    return { plan_id: id, expira_en: 'pronto' };
  },
  verPlan: async (_c: unknown, id: string) => m.planes.get(id) ?? null,
  tomarPlan: async (_c: unknown, id: string) => m.planes.get(id)!,
  guardarResultado: async () => undefined,
}));

import { buildMcpServer } from '../lib/mcp/server';
import { resolverPersona } from '../lib/mcp/comun';

const auth = {
  tipo: 'usuario',
  rol: 'operaciones',
  perfil: 'sesion',
  scopes: [],
  ctx: { db: {}, tenantId: 't', usuarioId: 'admin', origen: 'mcp' },
} as never;
async function cliente() {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await buildMcpServer(auth).connect(a);
  const c = new Client({ name: 'prueba', version: '1' });
  await c.connect(b);
  return c;
}
const texto = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0]!.text) as Record<string, unknown>;
const ACTA = '00000000-0000-4000-8000-0000000000a1';

beforeEach(() => {
  m.acta = { id: ACTA, tipo: 'cierre', mesa_id: 'm1', markdown: '# Acta de cierre', publicado_at: null };
  m.planes.clear();
  m.publicar.mockReset().mockResolvedValue({ acta_id: ACTA, basecamp_doc_id: 7, url: 'https://bc/7' });
});

// Escaneo del 13/10 (regla 4): publicar un acta es una escritura visible; el agente pide y una persona confirma.
describe('MCP: publish_document con plan y confirmación', () => {
  it('publish_document no publica: devuelve un plan con lo que publicaría', async () => {
    const c = await cliente();
    const r = texto(await c.callTool({ name: 'publish_document', arguments: { acta_id: ACTA } }));
    expect(m.publicar).not.toHaveBeenCalled();
    expect(r).toMatchObject({ publicaria: { tipo: 'cierre', mesa: 'Mesa Orión' } });
    expect(m.planes.get(r.plan_id as string)?.tool).toBe('publish_document');
  });
  it('confirm_plan publica, una sola vez', async () => {
    const c = await cliente();
    const { plan_id } = texto(await c.callTool({ name: 'publish_document', arguments: { acta_id: ACTA } }));
    expect(texto(await c.callTool({ name: 'confirm_plan', arguments: { plan_id: plan_id as string } }))).toMatchObject({
      basecamp_doc_id: 7,
    });
    expect(m.publicar).toHaveBeenCalledTimes(1);
  });
  it('si el acta se publicó entre el plan y la confirmación, no se vuelve a publicar', async () => {
    const c = await cliente();
    const { plan_id } = texto(await c.callTool({ name: 'publish_document', arguments: { acta_id: ACTA } }));
    m.acta = { ...m.acta!, publicado_at: '2026-10-13T12:00:00Z' };
    const r = await c.callTool({ name: 'confirm_plan', arguments: { plan_id: plan_id as string } });
    expect(r.isError).toBe(true);
    expect(m.publicar).not.toHaveBeenCalled();
  });
});

describe('MCP: responsables por nombre', () => {
  const equipo = [
    { id: 'u1', nombre: 'Ana López' },
    { id: 'u2', nombre: 'Mariana Ruiz' },
    { id: 'u3', nombre: 'Andrés Pérez' },
  ];
  it('«Ana» es Ana López, nunca Mariana', () => expect(resolverPersona(equipo, 'Ana')).toEqual({ id: 'u1' }));
  it('sin tildes ni mayúsculas', () => expect(resolverPersona(equipo, 'andres perez')).toEqual({ id: 'u3' }));
  it('ambiguo o inexistente: error con las opciones, no una adivinanza', () => {
    expect(resolverPersona(equipo, 'An')).toMatchObject({ error: expect.stringContaining('ambiguo') });
    expect(resolverPersona(equipo, 'Pedro')).toMatchObject({ error: expect.stringContaining('No hay nadie') });
  });
});
