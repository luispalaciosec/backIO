/**
 * Endpoint MCP (Streamable HTTP, sin estado). Auth: Authorization: Bearer bk_… (API key con scopes)
 * o JWT de usuario. Rate limit 100 req/min por credencial. Alerta si una key ejecuta >20 escrituras en 5 min.
 */
import { Hono } from 'hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { requireAuth } from '../lib/auth/middleware';
import { buildMcpServer } from '../lib/mcp/server';
import { sumarIntento } from '../lib/limite';

export const mcp = new Hono();

mcp.use('*', requireAuth);

mcp.all('/', async (c) => {
  const auth = c.get('auth');
  const clave = auth.ctx.apiKeyId ?? auth.ctx.usuarioId ?? 'anon';
  // 100 peticiones por minuto por credencial, en Postgres (sobrevive reinicios y réplicas; auditoría 10/10, punto 11).
  const lim = await sumarIntento(`mcp:${clave}`, 100, 60);
  if (lim.excedido) return c.json({ error: 'Rate limit: 100 req/min' }, 429, { 'Retry-After': String(lim.reintentarEn || 60) });
  const server = buildMcpServer(auth);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(c.req.raw);
  } finally {
    void transport.close().catch(() => undefined);
  }
});
