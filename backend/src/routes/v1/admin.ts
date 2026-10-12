import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '../../lib/validacion';
import { randomBytes } from 'node:crypto';
import { requireScope, ctxOf, hashApiKey } from '../../lib/auth/middleware';
import { listUsuarios, audit, serviceClient } from '../../lib/db';
import { frontendOrigins } from '../../config/env';
import { verificarSalud } from '../../lib/salud';
import { BasecampClient } from '../../lib/basecamp/client';
import { emailHabilitado, plantillaHtml, sendEmail } from '../../lib/notificaciones/email';
import { aplicarSalida, inventarioSalida } from '../../lib/salida';
import { aplicar, revisar, TAREAS, TopeExcedido, type Tarea } from '../../lib/mantenimiento';
import {
  actualizarUsuario,
  borrarInvitacion,
  buscarAuditoria,
  clienteEsDelTenant,
  crearApiKey,
  getInvitacion,
  guardarInvitacion,
  listApiKeys,
  listInvitaciones,
  reactivarUsuario,
  revocarApiKey,
  usuarioDelTenant,
  vincularUsuarioBasecamp,
} from '../../lib/db/admin';

export const admin = new Hono();
admin.use('*', requireScope('admin'));

const ROLES = ['admin', 'gerencia', 'operaciones', 'ejecutiva', 'lider', 'colaborador'] as const;

// ---------------- usuarios
// Con inactivos: quien ya no tiene acceso sigue en la lista (al final) para poder restaurarlo.
admin.get('/usuarios', async (c) => c.json({ items: await listUsuarios(ctxOf(c), { incluirInactivos: true }) }));

/** Escanea las personas de la cuenta Basecamp y enlaza usuarios por email (basecamp_user_id). */
admin.post('/usuarios/basecamp/vincular', async (c) => {
  const ctx = ctxOf(c);
  const bc = await BasecampClient.forTenant(ctx.tenantId);
  const [personas, usuarios] = await Promise.all([bc.listPeopleSafe(), listUsuarios(ctx)]);
  const porEmail = new Map(personas.filter((p) => p.email).map((p) => [p.email!, p]));
  const vinculados: { usuario: string; basecamp_user_id: number }[] = [];
  const sinCoincidencia: string[] = [];
  for (const u of usuarios) {
    const p = porEmail.get(u.email.toLowerCase());
    if (!p) {
      sinCoincidencia.push(`${u.nombre} <${u.email}>`);
      continue;
    }
    if (u.basecamp_user_id === p.id && (u.avatar_url || !p.avatar_url)) continue;
    await vincularUsuarioBasecamp(ctx, u.id, p.id, p.avatar_url ?? null);
    vinculados.push({ usuario: u.nombre, basecamp_user_id: p.id });
  }
  await audit(ctx, {
    accion: 'vincular_basecamp_usuarios',
    entidad: 'usuario',
    entidad_id: null,
    detalle: { vinculados: vinculados.length, sin_coincidencia: sinCoincidencia.length },
  });
  const emailsBackio = new Set(usuarios.map((u) => u.email.toLowerCase()));
  return c.json({
    personas_basecamp: personas.length,
    vinculados,
    sin_coincidencia: sinCoincidencia,
    solo_en_basecamp: personas.filter((p) => p.email && !emailsBackio.has(p.email)).map((p) => `${p.nombre} <${p.email}>`),
  });
});

admin.patch(
  '/usuarios/:id',
  zValidator(
    'json',
    z.object({
      rol: z.enum(ROLES).optional(),
      capacidad_semanal: z.number().int().min(1).max(80).optional(),
      basecamp_user_id: z.number().int().nullable().optional(),
      // Solo para reactivar: desactivar es la salida (/usuarios/:id/salida), que reparte lo abierto y deja rastro.
      activo: z.literal(true).optional(),
      nombre: z.string().min(2).optional(),
      area: z.enum(['cuentas', 'produccion', 'diseno', 'creatividad', 'content']).nullable().optional(),
    }),
  ),
  async (c) => {
    const ctx = ctxOf(c);
    const id = c.req.param('id');
    const patch = c.req.valid('json');
    if (id === ctx.usuarioId && patch.rol && patch.rol !== 'admin') {
      return c.json({ error: 'No puedes quitarte el rol admin' }, 422);
    }
    const data = await actualizarUsuario(ctx, id, patch);
    await audit(ctx, { accion: 'actualizar_usuario', entidad: 'usuario', entidad_id: id, detalle: patch });
    return c.json(data);
  },
);

// ---------------- invitaciones
admin.get('/invitaciones', async (c) => {
  const ctx = ctxOf(c);
  return c.json({ items: await listInvitaciones(ctx) });
});

admin.post(
  '/invitaciones',
  zValidator(
    'json',
    z.object({
      email: z.string().email(),
      nombre: z.string().min(2),
      rol: z.enum(ROLES).default('colaborador'),
      capacidad_semanal: z.number().int().min(1).max(80).default(40),
    }),
  ),
  async (c) => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const data = await guardarInvitacion(ctx, body);
    await audit(ctx, {
      accion: 'crear_invitacion',
      entidad: 'invitacion',
      entidad_id: data.id,
      detalle: { email: body.email, rol: body.rol },
    });
    const envio = await enviarInvitacion(body.email.toLowerCase(), body.nombre).catch((e: Error) => ({ enviado: false, error: e.message }));
    return c.json({ ...data, envio }, 201);
  },
);

/**
 * Crea (o reutiliza) la cuenta en Supabase Auth y envía el enlace de invitación por Resend.
 * El trigger handle_new_auth_user completa la fila en usuarios con el rol de la invitación.
 * El enlace lleva a /auth/establecer-clave en el frontend.
 */
async function enviarInvitacion(email: string, nombre: string): Promise<{ enviado: boolean; error?: string; url?: string }> {
  const sb = serviceClient();
  const base = `${frontendOrigins()[0] ?? 'http://localhost:3000'}/auth/establecer-clave`;
  // No usamos action_link (pasa por /auth/v1/verify y vuelve con tokens en el hash, que el cliente PKCE
  // del frontend rechaza como "enlace inválido"). Mandamos el token_hash y la página lo canjea con verifyOtp.
  const enlace = (hashedToken: string, tipo: 'invite' | 'recovery') => `${base}?token_hash=${encodeURIComponent(hashedToken)}&type=${tipo}`;
  const { data, error } = await sb.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo: base, data: { name: nombre } },
  });
  if (error) {
    // Usuario ya existente: enviar enlace de recuperación para que fije su clave.
    if (/already|exists|registered/i.test(error.message)) {
      const r = await sb.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo: base } });
      if (r.error) return { enviado: false, error: r.error.message };
      return mandar(email, nombre, enlace(r.data.properties.hashed_token, 'recovery'), true);
    }
    return { enviado: false, error: error.message };
  }
  return mandar(email, nombre, enlace(data.properties.hashed_token, 'invite'), false);
}

async function mandar(
  email: string,
  nombre: string,
  link: string,
  existente: boolean,
): Promise<{ enviado: boolean; error?: string; url?: string }> {
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
  const inv = await getInvitacion(ctx, c.req.param('id'));
  if (!inv) return c.json({ error: 'Invitación no encontrada' }, 404);
  const envio = await enviarInvitacion(inv.email, inv.nombre).catch((e: Error) => ({ enviado: false, error: e.message }));
  const { url: _url, ...sinEnlace } = envio as { url?: string; enviado: boolean; error?: string };
  await audit(ctx, { accion: 'reenviar_invitacion', entidad: 'invitacion', entidad_id: c.req.param('id'), detalle: sinEnlace });
  return c.json(envio, envio.enviado ? 200 : 422);
});

admin.delete('/invitaciones/:id', async (c) => {
  const ctx = ctxOf(c);
  await borrarInvitacion(ctx, c.req.param('id'));
  return c.body(null, 204);
});

// ---------------- api keys
const SCOPES = [
  'read:backlog',
  'read:proyectos',
  'read:senales',
  'read:capacidad',
  'write:requerimientos',
  'write:proyectos',
  'write:actas',
  'admin',
] as const;
const PERFILES: Record<string, readonly (typeof SCOPES)[number][]> = {
  gerencial: ['read:backlog', 'read:proyectos', 'read:senales', 'read:capacidad'],
  ejecutiva: ['read:backlog', 'read:proyectos', 'read:senales', 'read:capacidad', 'write:requerimientos'],
  operaciones: [
    'read:backlog',
    'read:proyectos',
    'read:senales',
    'read:capacidad',
    'write:requerimientos',
    'write:proyectos',
    'write:actas',
  ],
  prometio: ['read:proyectos', 'write:proyectos'],
  cliente: ['read:proyectos'],
};

admin.get('/api-keys', async (c) => {
  const ctx = ctxOf(c);
  return c.json({ items: await listApiKeys(ctx), perfiles: PERFILES });
});

/** La key completa se devuelve UNA sola vez. Solo se guarda el hash. */
admin.post(
  '/api-keys',
  zValidator(
    'json',
    z.object({
      nombre: z.string().min(2),
      perfil: z.enum(['gerencial', 'ejecutiva', 'operaciones', 'prometio', 'cliente', 'custom']),
      scopes: z.array(z.enum(SCOPES)).optional(),
      cliente_id: z.string().uuid().optional(),
    }),
  ),
  async (c) => {
    const ctx = ctxOf(c);
    // Solo una persona admin crea keys: una key creada por otra key quedaba sin dueño (creado_por null) y
    // sobrevivía a «Quitar acceso» de quien la originó (auditoría run-1).
    if (c.get('auth').tipo !== 'usuario' || !ctx.usuarioId)
      return c.json({ error: 'Las API keys solo las crea un administrador desde BackIO' }, 403);
    const body = c.req.valid('json');
    // Una key de perfil cliente lee solo los proyectos de UN cliente (S11): el cliente es obligatorio y debe ser del tenant.
    if (body.perfil === 'cliente') {
      if (!body.cliente_id) return c.json({ error: 'Una key de perfil cliente necesita el cliente al que pertenece' }, 400);
      if (!(await clienteEsDelTenant(ctx, body.cliente_id))) return c.json({ error: 'Cliente no encontrado' }, 404);
    }
    const scopes = body.perfil === 'custom' ? (body.scopes ?? []) : [...PERFILES[body.perfil]!];
    const key = `bk_live_${randomBytes(24).toString('base64url')}`;
    const data = await crearApiKey(ctx, {
      nombre: body.nombre,
      prefijo: key.slice(0, 12),
      key_hash: hashApiKey(key),
      scopes,
      perfil: body.perfil,
      cliente_id: body.perfil === 'cliente' ? body.cliente_id : null,
      creado_por: ctx.usuarioId,
    });
    await audit(ctx, {
      accion: 'crear_api_key',
      entidad: 'api_key',
      entidad_id: data.id,
      detalle: { nombre: body.nombre, scopes },
    });
    return c.json({ ...data, key }, 201);
  },
);

admin.post('/api-keys/:id/revocar', async (c) => {
  const ctx = ctxOf(c);
  await revocarApiKey(ctx, c.req.param('id'));
  await audit(ctx, { accion: 'revocar_api_key', entidad: 'api_key', entidad_id: c.req.param('id') });
  return c.body(null, 204);
});

// ---------------- auditoría reciente
admin.get('/audit', async (c) => {
  const ctx = ctxOf(c);
  const q = c.req.query();
  const limit = Math.min(Number(q.limit ?? 200) || 200, 1000);
  return c.json(await buscarAuditoria(ctx, q, limit));
});

// ---------------- salud del sistema
admin.get('/salud', async (c) => c.json(await verificarSalud(ctxOf(c).tenantId)));

// ---------------- mantenimiento: reparaciones de datos en dos pasos (revisar → aplicar)
const tareaValida = (t: string): t is Tarea => Object.hasOwn(TAREAS, t);

admin.get('/mantenimiento', (c) => c.json({ items: Object.entries(TAREAS).map(([id, t]) => ({ id, ...t })) }));

admin.post('/mantenimiento/:tarea/revisar', async (c) => {
  const tarea = c.req.param('tarea');
  if (!tareaValida(tarea)) return c.json({ error: 'Tarea desconocida' }, 404);
  const acciones = await revisar(ctxOf(c), tarea);
  return c.json({ items: acciones.map(({ datos: _datos, ...a }) => a) });
});

admin.post(
  '/mantenimiento/:tarea/aplicar',
  zValidator('json', z.object({ ids: z.array(z.string().uuid()).min(1).max(2000) })),
  async (c) => {
    const tarea = c.req.param('tarea');
    if (!tareaValida(tarea)) return c.json({ error: 'Tarea desconocida' }, 404);
    try {
      return c.json(await aplicar(ctxOf(c), tarea, c.req.valid('json').ids));
    } catch (e) {
      if (e instanceof TopeExcedido) return c.json({ error: e.message }, 422);
      throw e;
    }
  },
);

// ---------------- accesos: salida (docs/20-salida.md) y restaurar
/** Todo lo que la persona tiene abierto, con el destino propuesto. No escribe. */
admin.get('/usuarios/:id/salida', async (c) => c.json(await inventarioSalida(ctxOf(c), c.req.param('id'))));

const destino = z.string().uuid().nullable();
const asignacion = z.array(z.object({ id: z.string().uuid(), a: destino })).max(5000);

/**
 * Registra la salida con el plan confirmado: reparte lo abierto, revoca credenciales y desactiva (una transacción);
 * después bloquea el ingreso en Supabase Auth y cambia al responsable en Basecamp.
 */
admin.post(
  '/usuarios/:id/salida',
  zValidator(
    'json',
    z.object({
      fecha_salida: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      motivo: z.string().max(300).nullable().optional(),
      tareas: asignacion,
      proyectos: asignacion,
      mesas: asignacion,
      acuerdos: z.array(z.object({ id: z.string().uuid(), a: z.string().uuid() })).max(500),
      recurrencias: asignacion,
    }),
  ),
  async (c) => c.json(await aplicarSalida(ctxOf(c), c.req.param('id'), c.req.valid('json'))),
);

/** Restaurar acceso: reactiva, desbloquea en Auth y manda un enlace para definir contraseña nueva. */
admin.post('/usuarios/:id/restaurar-acceso', async (c) => {
  const ctx = ctxOf(c);
  const id = c.req.param('id');
  const db = serviceClient();
  const u = await usuarioDelTenant(ctx, id);
  if (!u) return c.json({ error: 'Usuario no encontrado' }, 404);
  await reactivarUsuario(ctx, id);
  try {
    await db.auth.admin.updateUserById(id, { ban_duration: 'none' });
  } catch {
    /* si no existe en auth, la invitación lo crea */
  }
  const envio = await enviarInvitacion(u.email, u.nombre).catch((e: Error) => ({
    enviado: false,
    error: e.message,
  }));
  const { url: _url, ...sinEnlace } = envio as { url?: string; enviado: boolean; error?: string };
  await audit(ctx, {
    accion: 'restaurar_acceso',
    entidad: 'usuario',
    entidad_id: id,
    detalle: { email: u.email, envio: sinEnlace },
  });
  return c.json({ ok: true, envio });
});
