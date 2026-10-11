/**
 * Piezas comunes de las tools MCP: respuesta, permisos, vista interna de un requerimiento y resolución de nombres.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthInfo, Scope } from '../auth/middleware';
import type { DbCtx } from '../db/client';
import { listClientes } from '../db/clientes';
import { listUsuarios } from '../db/usuarios';
import type { Requerimiento } from '@backio/shared';

export type Text = { content: { type: 'text'; text: string }[]; isError?: boolean };
export const ok = (data: unknown): Text => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
export const fail = (msg: string): Text => ({ content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], isError: true });

const ROLES_GESTION = new Set(['admin', 'gerencia', 'operaciones', 'ejecutiva', 'lider']);
export function tiene(auth: AuthInfo, ...scopes: Scope[]): boolean {
  if (auth.tipo === 'usuario') {
    if (auth.perfil === 'oauth' && !scopes.every((s) => auth.scopes.includes(s))) return false;
    const escribe = scopes.some((s) => s.startsWith('write:'));
    return !escribe || (auth.rol !== null && ROLES_GESTION.has(auth.rol));
  }
  return auth.scopes.includes('admin') || scopes.every((s) => auth.scopes.includes(s));
}
export const esScopeCliente = (auth: AuthInfo) => auth.tipo === 'api_key' && auth.perfil === 'cliente';

/** Vista interna de un requerimiento para agentes: sin texto de Basecamp por construcción. */
export function reqInterno(
  r: Requerimiento & Partial<{ dias_atraso: number; dias_sin_movimiento: number }>,
  nombres: Map<string, string>,
  clientes: Map<string, string>,
) {
  return {
    id: r.id,
    cliente: clientes.get(r.cliente_id) ?? r.cliente_id,
    proyecto_id: r.proyecto_id,
    bloque: r.bloque_nombre,
    titulo: r.titulo_interno,
    etiqueta_cliente: r.etiqueta_cliente,
    visible_cliente: r.visible_cliente,
    estado: r.estado_operativo,
    aprobacion: r.estado_aprobacion,
    prioridad: r.prioridad,
    tipo: r.tipo_trabajo,
    peso: Number(r.peso),
    fecha_pedido: r.fecha_pedido,
    fecha_entrega: r.fecha_entrega,
    veces_reprogramado: r.veces_reprogramado,
    owners: r.owner_agencia.map((id) => nombres.get(id) ?? id),
    piezas: r.piezas,
    dias_atraso: r.dias_atraso ?? null,
    dias_sin_movimiento: r.dias_sin_movimiento ?? null,
    basecamp_url: r.basecamp_url,
  };
}

export async function mapas(ctx: DbCtx) {
  const [u, c] = await Promise.all([listUsuarios(ctx), listClientes(ctx, { incluirInactivos: true })]);
  return {
    nombres: new Map(u.map((x) => [x.id, x.nombre])),
    clientes: new Map(c.map((x) => [x.id, x.nombre])),
    usuarios: u,
    listaClientes: c,
  };
}

export async function resolverCliente(ctx: DbCtx, ref: string | undefined) {
  if (!ref) return null;
  const todos = await listClientes(ctx, { incluirInactivos: true });
  const q = ref.toLowerCase();
  return (
    todos.find((c) => c.id === ref) ?? todos.find((c) => c.slug === q) ?? todos.find((c) => c.nombre.toLowerCase().includes(q)) ?? null
  );
}

/** Lo que cada grupo de tools necesita para registrarse. */
export interface Herramientas {
  server: McpServer;
  auth: AuthInfo;
  ctx: DbCtx;
  guard: (scopes: Scope[], fn: () => Promise<Text>) => () => Promise<Text>;
}
