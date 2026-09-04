/**
 * Endpoint MCP (Streamable HTTP, sin estado). Auth: Authorization: Bearer bk_… (API key con scopes)
 * o JWT de usuario. Rate limit 100 req/min por credencial. Alerta si una key ejecuta >20 escrituras en 5 min.
 */
import { Hono } from 'hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { requireAuth } from '../lib/auth/middleware';
import { buildMcpServer } from '../lib/mcp/server';

export const mcp = new Hono();

const ventana = new Map<string, number[]>();
function rateLimited(key: string, max = 100, ms = 60_000): boolean {
  const ahora = Date.now();
  const arr = (ventana.get(key) ?? []).filter((t) => ahora - t < ms);
  arr.push(ahora);
  ventana.set(key, arr);
  return arr.length > max;
}

mcp.use('*', requireAuth);

mcp.all('/', async (c) => {
  const auth = c.get('auth');
  const clave = auth.ctx.apiKeyId ?? auth.ctx.usuarioId ?? 'anon';
  if (rateLimited(clave)) return c.json({ error: 'Rate limit: 100 req/min' }, 429);
  const server = buildMcpServer(auth);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(c.req.raw);
  } finally {
    void transport.close().catch(() => undefined);
  }
});
