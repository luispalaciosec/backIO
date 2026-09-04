import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { randomBytes } from 'node:crypto';
import { requireScope, ctxOf, hashApiKey } from '../../lib/auth/middleware';
import { listUsuarios, audit, throwIf, serviceClient } from '../../lib/db';
import { frontendOrigins } from '../../config/env';
import { emailHabilitado, plantillaHtml, sendEmail } from '../../lib/notificaciones/email';

export const admin = new Hono();
admin.use('*', requireScope('admin'));

const ROLES = ['admin', 'gerencia', 'operaciones', 'ejecutiva', 'lider', 'colaborador'] as const;

// ---------------- usuarios
admin.get('/usuarios', async (c) => c.json({ items: await listUsuarios(ctxOf(c)) }));

admin.patch('/usuarios/:id', zValidator('json', z.object({
  rol: z.enum(ROLES).optional(),
  capacidad_semanal: z.number().int().min(1).max(80).optional(),
  basecamp_user_id: z.number().int().nullable().optional(),
  activo: z.boolean().optional(),
  nombre: z.string().min(2).optional(),
})), async (c) => {
  const ctx = ctxOf(c);
  const id = c.req.param('id');
  const patch = c.req.valid('json');
  if (id === ctx.usuarioId && (patch.rol && patch.rol !== 'admin' || patch.activo === false)) {
    return c.json({ error: 'No puedes quitarte el rol admin ni desactivarte a ti mismo' }, 422);
  }
  const { data, error } = await ctx.db.from('usuarios').update(patch).eq('tenant_id', ctx.tenantId).eq('id', id).select().single();
  throwIf(error);
  await audit(ctx, { accion: 'actualizar_usuario', entidad: 'usuario', entidad_id: id, detalle: patch });
  return c.json(data);
});

// ---------------- invitaciones
admin.get('/invitaciones', async (c) => {
  const ctx = ctxOf(c);
  const { data, error } = await ctx.db.from('invitaciones').select('*').eq('tenant_id', ctx.tenantId).order('created_at', { ascending: false });
  throwIf(error);
  return c.json({ items: data ?? [] });
});

admin.post('/invitaciones', zValidator('json', z.object({
  email: z.string().email(),
  nombre: z.string().min(2),
  rol: z.enum(ROLES).default('colaborador'),
  capacidad_semanal: z.number().int().min(1).max(80).default(40),
})), async (c) => {
  const ctx = ctxOf(c);
  const body = c.req.valid('json');
  const { data, error } = await ctx.db
    .from('invitaciones')
    .upsert({ ...body, email: body.email.toLowerCase(), tenant_id: ctx.tenantId, created_by: ctx.usuarioId }, { onConflict: 'tenant_id,email' })
    .select()
    .single();
  throwIf(error);
  await audit(ctx, { accion: 'crear_invitacion', entidad: 'invitacion', entidad_id: (data as { id: string }).id, detalle: { email: body.email, rol: body.rol } });
  const envio = await enviarInvitacion(body.email.toLowerCase(), body.nombre).catch((e: Error) => ({ enviado: false, error: e.message }));
  return c.json({ ...(data as object), envio }, 201);
});

/**
 * Crea (o reutiliza) la cuenta en Supabase Auth y envía el enlace de invitación por Resend.
 * El trigger handle_new_auth_user completa la fila en usuarios con el rol de la invitación.
 * El enlace lleva a /auth/establecer-clave en el frontend.
 */
async function enviarInvitacion(email: string, nombre: string): Promise<{ enviado: boolean; error?: string; url?: string }> {
  const sb = serviceClient();
  const redirectTo = `${frontendOrigins()[0] ?? 'http://localhost:3000'}/auth/establecer-clave`;
  const { data, error } = await sb.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo, data: { name: nombre } } });
  if (error) {
    // Usuario ya existente: enviar enlace de recuperación para que fije su clave.
    if (/already|exists|registered/i.test(error.message)) {
      const r = await sb.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } });
      if (r.error) return { enviado: false, error: r.error.message };
      return mandar(email, nombre, r.data.properties.action_link, true);
    }
    return { enviado: false, error: error.message };
  }
  return mandar(email, nombre, data.properties.action_link, false);
}

async function mandar(email: string, nombre: string, link: string, existente: boolean): Promise<{ enviado: boolean; error?: string; url?: string }> {
  if (!emailHabilitado()) return { enviado: false, error: 'RESEND_API_KEY no configurada; comparte el enlace manualmente', url: link };
  const titulo = existente ? 'Restablece tu acceso a BackIO' : 'Te invitaron a BackIO';
  const cuerpo = existente
    ? `Hola ${nombre}. Usa el botón para definir tu contraseña y entrar a BackIO, la capa de gestión de Geeks.`
    : `Hola ${nombre}. Te crearon una cuenta en BackIO, la capa de gestión de backlog de Geeks. Usa el botón para definir tu contraseña y entrar. El enlace vence en 24 horas.`;
  await sendEmail({ to: email, subject: `[BackIO] ${titulo}`, html: plantillaHtml(titulo, cuerpo, link), text: `${cuerpo}\n${link}` });
  return { enviado: true };
}

admin.post('/invitaciones/:id/reenviar', async (c) => {
  const ctx = ctxOf(c);
  const { data, error } = await ctx.db.from('invitaciones').select('email, nombre').eq('tenant_id', ctx.tenantId).eq('id', c.req.param('id')).maybeSingle();
  throwIf(error);
  if (!data) return c.json({ error: 'Invitación no encontrada' }, 404);
  const inv = data as { email: string; nombre: string };
  const envio = await enviarInvitacion(inv.email, inv.nombre).catch((e: Error) => ({ enviado: false, error: e.message }));
  await audit(ctx, { accion: 'reenviar_invitacion', entidad: 'invitacion', entidad_id: c.req.param('id'), detalle: envio });
  return c.json(envio, envio.enviado ? 200 : 422);
});

admin.delete('/invitaciones/:id', async (c) => {
  const ctx = ctxOf(c);
  const { error } = await ctx.db.from('invitaciones').delete().eq('tenant_id', ctx.tenantId).eq('id', c.req.param('id'));
  throwIf(error);
  return c.body(null, 204);
});

// ---------------- api keys
const SCOPES = ['read:backlog', 'read:proyectos', 'read:senales', 'read:capacidad', 'write:requerimientos', 'write:proyectos', 'write:actas', 'admin'] as const;
const PERFILES: Record<string, readonly (typeof SCOPES)[number][]> = {
  gerencial: ['read:backlog', 'read:proyectos', 'read:senales', 'read:capacidad'],
  ejecutiva: ['read:backlog', 'read:proyectos', 'read:senales', 'read:capacidad', 'write:requerimientos'],
  operaciones: ['read:backlog', 'read:proyectos', 'read:senales', 'read:capacidad', 'write:requerimientos', 'write:proyectos', 'write:actas'],
  prometio: ['read:proyectos', 'write:proyectos'],
  cliente: ['read:proyectos'],
};

admin.get('/api-keys', async (c) => {
  const ctx = ctxOf(c);
  const { data, error } = await serviceClient().from('api_keys').select('id, nombre, prefijo, scopes, perfil, ultimo_uso_at, revocada_at, created_at').eq('tenant_id', ctx.tenantId).order('created_at', { ascending: false });
  throwIf(error);
  return c.json({ items: data ?? [], perfiles: PERFILES });
});

/** La key completa se devuelve UNA sola vez. Solo se guarda el hash. */
admin.post('/api-keys', zValidator('json', z.object({
  nombre: z.string().min(2),
  perfil: z.enum(['gerencial', 'ejecutiva', 'operaciones', 'prometio', 'cliente', 'custom']),
  scopes: z.array(z.enum(SCOPES)).optional(),
})), async (c) => {
  const ctx = ctxOf(c);
  const body = c.req.valid('json');
  const scopes = body.perfil === 'custom' ? (body.scopes ?? []) : PERFILES[body.perfil]!;
  const key = `bk_live_${randomBytes(24).toString('base64url')}`;
  const { data, error } = await serviceClient()
    .from('api_keys')
    .insert({ tenant_id: ctx.tenantId, nombre: body.nombre, prefijo: key.slice(0, 12), key_hash: hashApiKey(key), scopes, perfil: body.perfil, creado_por: ctx.usuarioId })
    .select('id, nombre, prefijo, scopes, perfil, created_at')
    .single();
  throwIf(error);
  await audit(ctx, { accion: 'crear_api_key', entidad: 'api_key', entidad_id: (data as { id: string }).id, detalle: { nombre: body.nombre, scopes } });
  return c.json({ ...(data as object), key }, 201);
});

admin.post('/api-keys/:id/revocar', async (c) => {
  const ctx = ctxOf(c);
  const { error } = await serviceClient().from('api_keys').update({ revocada_at: new Date().toISOString() }).eq('tenant_id', ctx.tenantId).eq('id', c.req.param('id'));
  throwIf(error);
  await audit(ctx, { accion: 'revocar_api_key', entidad: 'api_key', entidad_id: c.req.param('id') });
  return c.body(null, 204);
});

// ---------------- auditoría reciente
admin.get('/audit', async (c) => {
  const ctx = ctxOf(c);
  const { data, error } = await serviceClient().from('audit_log').select('*').eq('tenant_id', ctx.tenantId).order('created_at', { ascending: false }).limit(100);
  throwIf(error);
  return c.json({ items: data ?? [] });
});
