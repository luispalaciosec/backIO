import { Hono } from 'hono';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import { listUsuarios } from '../../lib/db';

export const usuarios = new Hono();

usuarios.get('/', requireScope('read:capacidad'), async (c) => {
  const items = await listUsuarios(ctxOf(c));
  return c.json({ items: items.map(({ email: _e, ...u }) => u), total: items.length });
});

usuarios.get('/me', async (c) => {
  const a = c.get('auth');
  return c.json({ tipo: a.tipo, nombre: a.nombre, rol: a.rol, scopes: a.scopes, tenant_id: a.ctx.tenantId, usuario_id: a.ctx.usuarioId });
});
