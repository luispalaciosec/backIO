/**
 * Recuperación de contraseña (pública, sin sesión). Siempre responde ok para no revelar si el correo existe.
 * Genera el enlace de recuperación con Supabase (token_hash) y lo manda por Resend a /auth/establecer-clave.
 * Límite: una solicitud por correo cada 60 s (en memoria, suficiente para un equipo).
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '../lib/validacion';
import { serviceClient } from '../lib/db';
import { frontendOrigins } from '../config/env';
import { emailHabilitado, plantillaHtml, sendEmail } from '../lib/notificaciones/email';
import { ipCliente } from '../lib/ip';
import { limitar, sumarIntento } from '../lib/limite';
import { verificarTurnstile } from '../lib/turnstile';

export const authPublico = new Hono();
// 10 por IP cada 15 min y 1 por correo por minuto, persistentes (auditoría 10/10, punto 11); captcha si está activo.
authPublico.post(
  '/recuperar',
  limitar('recuperar_ip', 10, 900, ipCliente),
  zValidator('json', z.object({ email: z.string().email().max(254), captcha: z.string().max(2048).optional() })),
  async (c) => {
    const { email: crudo, captcha } = c.req.valid('json');
    const email = crudo.trim().toLowerCase();
    if (!(await verificarTurnstile(captcha, ipCliente(c)))) return c.json({ error: 'Completa la verificación antes de enviar.' }, 400);
    if ((await sumarIntento(`recuperar_email:${email}`, 1, 60)).excedido) return c.json({ ok: true });
    try {
      const sb = serviceClient();
      const { data: u } = await sb.from('usuarios').select('id, nombre, activo').eq('email', email).maybeSingle();
      const usuario = u as { id: string; nombre: string; activo: boolean } | null;
      if (!usuario?.activo) return c.json({ ok: true }); // no revelar
      const base = `${frontendOrigins()[0] ?? 'http://localhost:3000'}/auth/establecer-clave`;
      const { data, error } = await sb.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo: base } });
      if (error || !data) {
        console.error('[recuperar] generateLink', error?.message);
        return c.json({ ok: true });
      }
      const link = `${base}?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery`;
      if (!emailHabilitado()) {
        console.warn('[recuperar] RESEND no configurado; enlace no enviado');
        return c.json({ ok: true });
      }
      const cuerpo = `Hola ${usuario.nombre}. Recibimos una solicitud para restablecer tu contraseña de BackIO. Usa el botón para definir una nueva. El enlace vence en 24 horas.\nSi no fuiste tú, ignora este correo: tu contraseña actual sigue igual.`;
      await sendEmail({
        to: email,
        subject: '[BackIO] Restablece tu contraseña',
        html: plantillaHtml('Restablece tu contraseña', cuerpo, link),
        text: `${cuerpo}\n${link}`,
      });
      await sb
        .from('audit_log')
        .insert({
          tenant_id: (await sb.from('usuarios').select('tenant_id').eq('id', usuario.id).single()).data?.tenant_id,
          usuario_id: usuario.id,
          origen: 'ui',
          accion: 'recuperar_contrasena',
          entidad: 'usuario',
          entidad_id: usuario.id,
          detalle: {},
        })
        .then(
          () => undefined,
          () => undefined,
        );
    } catch (err) {
      console.error('[recuperar]', err instanceof Error ? err.message : err);
    }
    return c.json({ ok: true });
  },
);
