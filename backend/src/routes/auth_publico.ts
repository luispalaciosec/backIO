/**
 * Recuperación de contraseña (pública, sin sesión). Siempre responde ok para no revelar si el correo existe.
 * Genera el enlace de recuperación con Supabase (token_hash) y lo manda por Resend a /auth/establecer-clave.
 * Límite: una solicitud por correo cada 60 s (en memoria, suficiente para un equipo).
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { serviceClient } from '../lib/db';
import { frontendOrigins } from '../config/env';
import { emailHabilitado, plantillaHtml, sendEmail } from '../lib/notificaciones/email';

export const authPublico = new Hono();
const ultimo = new Map<string, number>();

authPublico.post('/recuperar', zValidator('json', z.object({ email: z.string().email() })), async (c) => {
  const email = c.req.valid('json').email.trim().toLowerCase();
  const ahora = Date.now();
  if ((ultimo.get(email) ?? 0) > ahora - 60_000) return c.json({ ok: true });
  ultimo.set(email, ahora);
  try {
    const sb = serviceClient();
    const { data: u } = await sb.from('usuarios').select('id, nombre, activo').eq('email', email).maybeSingle();
    const usuario = u as { id: string; nombre: string; activo: boolean } | null;
    if (!usuario?.activo) return c.json({ ok: true }); // no revelar
    const base = `${frontendOrigins()[0] ?? 'http://localhost:3000'}/auth/establecer-clave`;
    const { data, error } = await sb.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo: base } });
    if (error || !data) { console.error('[recuperar] generateLink', error?.message); return c.json({ ok: true }); }
    const link = `${base}?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery`;
    if (!emailHabilitado()) { console.warn('[recuperar] RESEND no configurado; enlace no enviado'); return c.json({ ok: true }); }
    const cuerpo = `Hola ${usuario.nombre}. Recibimos una solicitud para restablecer tu contraseña de BackIO. Usa el botón para definir una nueva. El enlace vence en 24 horas.\nSi no fuiste tú, ignora este correo: tu contraseña actual sigue igual.`;
    await sendEmail({ to: email, subject: '[BackIO] Restablece tu contraseña', html: plantillaHtml('Restablece tu contraseña', cuerpo, link), text: `${cuerpo}\n${link}` });
    await sb.from('audit_log').insert({ tenant_id: (await sb.from('usuarios').select('tenant_id').eq('id', usuario.id).single()).data?.tenant_id, usuario_id: usuario.id, origen: 'ui', accion: 'recuperar_contrasena', entidad: 'usuario', entidad_id: usuario.id, detalle: {} }).then(() => undefined, () => undefined);
  } catch (err) {
    console.error('[recuperar]', err instanceof Error ? err.message : err);
  }
  return c.json({ ok: true });
});
