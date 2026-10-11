/**
 * MCP Server de BackIO (docs/07). Una capa para Claude, ChatGPT, Gemini y agentes futuros.
 *
 * Regla crítica: ninguna tool devuelve texto de Basecamp (estructuralmente imposible: nunca entra
 * a la base). Con scope cliente, get_project_status devuelve sanitizeForClient.
 * Escrituras: preview + confirm, plan_id de 15 min y un solo uso. Todo auditado.
 *
 * ZONA DE REVISIÓN HUMANA: las tools de escritura viven en tools/write_*.ts (plan_*, confirm_plan, actas).
 * Este archivo solo arma el servidor: contexto, guard de permisos y registro de cada grupo de tools.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthInfo, Scope } from '../auth/middleware';
import type { DbCtx } from '../db/client';
import { DbError } from '../db/client';
import { type Text, fail, tiene } from './comun';
import { registrarLectura } from './tools/read';
import { registrarPlanes } from './tools/write_plans';
import { registrarActas } from './tools/write_actas';
import { registrarConfirmacion } from './tools/write_confirm';

export function buildMcpServer(auth: AuthInfo): McpServer {
  const ctx: DbCtx = { ...auth.ctx, origen: 'mcp' };
  const server = new McpServer({ name: 'backio', version: '0.1.0' });
  const guard = (scopes: Scope[], fn: () => Promise<Text>) => async (): Promise<Text> => {
    if (!tiene(auth, ...scopes)) return fail(`Scope requerido: ${scopes.join(', ')}`);
    try {
      return await fn();
    } catch (err) {
      return fail(err instanceof DbError || err instanceof Error ? err.message : String(err));
    }
  };

  const h = { server, auth, ctx, guard };
  registrarLectura(h);
  registrarPlanes(h);
  registrarActas(h);
  registrarConfirmacion(h);
  return server;
}
