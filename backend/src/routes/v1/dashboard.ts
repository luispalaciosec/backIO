import { Hono } from 'hono';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import { buildDashboard } from '../../lib/dashboard';

export const dashboard = new Hono();
dashboard.get('/', requireScope('read:backlog', 'read:proyectos'), async (c) => c.json(await buildDashboard(ctxOf(c), c.req.query('mesa') || null)));
