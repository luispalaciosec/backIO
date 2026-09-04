/** Envío por Resend (API REST, sin SDK). Remitente en dominio ya verificado por PrometIO. */
import { env } from '../../config/env';

export interface Email { to: string; subject: string; html: string; text?: string }

export function emailHabilitado(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export async function sendEmail(m: Email): Promise<{ id: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY no configurada');
  const from = process.env.EMAIL_FROM ?? 'BackIO <no-reply@crm.geeks.com.ec>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'User-Agent': env().BASECAMP_USER_AGENT },
    body: JSON.stringify({ from, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return (await res.json()) as { id: string };
}

export function plantillaHtml(titulo: string, cuerpo: string, url?: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const parrafos = cuerpo.split('\n').filter(Boolean).map((p) => `<p style="margin:0 0 12px">${esc(p)}</p>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2937">
<div style="max-width:560px;margin:24px auto;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:28px">
<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;margin-bottom:8px">BackIO · Geeks</div>
<h1 style="font-size:20px;margin:0 0 16px">${esc(titulo)}</h1>
<div style="font-size:15px;line-height:1.5">${parrafos}</div>
${url ? `<p style="margin:20px 0 0"><a href="${url}" style="display:inline-block;background:#0073EA;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600">Abrir en BackIO</a></p>` : ''}
<p style="font-size:12px;color:#9ca3af;margin:24px 0 0">Mensaje automático. No respondas a este correo.</p>
</div></body></html>`;
}
