/** Envío por Resend (API REST, sin SDK). Remitente en dominio ya verificado por PrometIO. */
import { env } from '../../config/env';

export interface Email {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

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

/** Correo con bloques: secciones con conteo y filas. Se guarda junto al aviso; la campana solo muestra `cuerpo`. */
export type TonoCorreo = 'rojo' | 'ambar' | 'azul' | 'gris' | 'verde';
export interface CorreoFila {
  texto: string;
  detalle?: string;
}
export interface CorreoSeccion {
  titulo: string;
  tono: TonoCorreo;
  /** Total real; si hay más que las filas que se muestran, dice «y N más en BackIO». */
  total: number;
  nota?: string;
  filas: CorreoFila[];
}
export interface CorreoRico {
  saludo?: string;
  intro?: string;
  secciones: CorreoSeccion[];
  /** Texto del botón; manda sobre el del tipo de aviso. */
  accion?: string;
  pie?: string;
}

const TONOS: Record<TonoCorreo, { fondo: string; texto: string }> = {
  rojo: { fondo: '#FDECEC', texto: '#B42318' },
  ambar: { fondo: '#FEF3E2', texto: '#B54708' },
  azul: { fondo: '#E6F1FD', texto: '#0056B3' },
  gris: { fondo: '#EEF0F3', texto: '#475467' },
  verde: { fondo: '#E7F6EC', texto: '#0B7A3B' },
};
const PIE_DEFECTO = 'Mensaje automático de BackIO. No respondas a este correo.';

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const FILA_ESTILO = 'padding:9px 0;border-top:1px solid #EAECF0';

function filaHtml(texto: unknown, detalle?: unknown): string {
  return `<tr><td style="${FILA_ESTILO}"><div style="font-size:14px;line-height:1.4;font-weight:600;color:#1D2939">${esc(texto)}</div>${
    detalle ? `<div style="font-size:13px;line-height:1.4;color:#667085;margin-top:2px">${esc(detalle)}</div>` : ''
  }</td></tr>`;
}

function seccionHtml(s: CorreoSeccion): string {
  const tono = TONOS[s.tono] ?? TONOS.gris;
  const filas = Array.isArray(s.filas) ? s.filas : [];
  const resto = Number(s.total) - filas.length;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px"><tr><td style="padding:0 0 8px"><span style="font-size:15px;font-weight:700;color:#101828">${esc(s.titulo)}</span>&nbsp; <span style="display:inline-block;font-size:12px;font-weight:700;line-height:1;padding:4px 8px;border-radius:10px;background:${tono.fondo};color:${tono.texto}">${esc(s.total)}</span>${
    s.nota ? `<div style="font-size:13px;line-height:1.4;color:#475467;margin-top:4px">${esc(s.nota)}</div>` : ''
  }</td></tr>${filas.map((f) => filaHtml(f?.texto, f?.detalle)).join('')}${
    resto > 0 ? `<tr><td style="${FILA_ESTILO};font-size:13px;color:#667085">y ${resto} más en BackIO</td></tr>` : ''
  }</table>`;
}

/** Texto suelto de un aviso: los renglones que empiezan con «• » salen como lista; los demás, como párrafos. */
function textoHtml(cuerpo: string): string {
  const out: string[] = [];
  let lista: string[] = [];
  const cerrar = () => {
    if (lista.length)
      out.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px">${lista.join('')}</table>`);
    lista = [];
  };
  for (const l of cuerpo.split('\n').filter(Boolean)) {
    if (l.startsWith('• ')) lista.push(filaHtml(l.slice(2)));
    else {
      cerrar();
      out.push(`<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#344054">${esc(l)}</p>`);
    }
  }
  cerrar();
  return out.join('');
}

export function plantillaHtml(
  titulo: string,
  cuerpo: string,
  url?: string,
  opts: { accion?: string; correo?: CorreoRico; enlaceVisible?: boolean } = {},
): string {
  const c = opts.correo;
  const accion = c?.accion ?? opts.accion ?? 'Abrir en BackIO';
  const previa = (c?.intro ?? cuerpo.split('\n').find(Boolean) ?? '').slice(0, 140);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head><body style="margin:0;padding:0;background:#F2F4F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1D2939">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(previa)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F4F7"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 12px;font-size:15px;font-weight:800;letter-spacing:-.01em;color:#0073EA">BackIO<span style="font-weight:500;color:#667085"> · Geeks</span></td></tr>
<tr><td style="background:#FFFFFF;border:1px solid #EAECF0;border-radius:10px;padding:26px 24px">
${c?.saludo ? `<p style="margin:0 0 4px;font-size:14px;color:#667085">${esc(c.saludo)}</p>` : ''}
<h1 style="margin:0 0 12px;font-size:21px;line-height:1.3;font-weight:700;color:#101828">${esc(titulo)}</h1>
${c?.intro ? `<p style="margin:0 0 22px;font-size:15px;line-height:1.5;color:#344054">${esc(c.intro)}</p>` : ''}
${c ? (Array.isArray(c.secciones) ? c.secciones : []).map(seccionHtml).join('') : textoHtml(cuerpo)}
${url ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 0"><tr><td style="border-radius:6px;background:#0073EA"><a href="${esc(url)}" style="display:inline-block;padding:12px 20px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none">${esc(accion)}</a></td></tr></table>` : ''}
${url && opts.enlaceVisible ? `<p style="margin:14px 0 0;font-size:12px;line-height:1.4;color:#667085;word-break:break-all">Si el botón no abre, copia este enlace: ${esc(url)}</p>` : ''}
</td></tr>
<tr><td style="padding:14px 4px 0;font-size:12px;line-height:1.5;color:#667085">${esc(c?.pie ?? PIE_DEFECTO)}</td></tr>
</table></td></tr></table></body></html>`;
}

/** Versión de texto del correo con bloques: la misma información, para los clientes de correo que no muestran HTML. */
export function textoPlano(titulo: string, cuerpo: string, correo: CorreoRico | undefined, url?: string): string {
  const partes: string[] = [];
  if (correo) {
    if (correo.saludo) partes.push(correo.saludo);
    partes.push(titulo);
    if (correo.intro) partes.push(correo.intro);
    for (const s of correo.secciones ?? []) {
      const filas = Array.isArray(s.filas) ? s.filas : [];
      const resto = Number(s.total) - filas.length;
      partes.push(
        [
          `${s.titulo} (${s.total})`,
          ...(s.nota ? [s.nota] : []),
          ...filas.map((f) => `- ${f.texto}${f.detalle ? ` · ${f.detalle}` : ''}`),
          ...(resto > 0 ? [`y ${resto} más en BackIO`] : []),
        ].join('\n'),
      );
    }
  } else partes.push(cuerpo);
  if (url) partes.push(url);
  return partes.join('\n\n');
}
