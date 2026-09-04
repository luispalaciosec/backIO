/**
 * Notificaciones: se encolan en la tabla y se envían por correo (canal decidido: correo).
 * `notificar` inserta una fila por destinatario e intenta enviar de inmediato; lo que falle
 * lo reintenta el scheduler (procesarPendientes) hasta 5 veces.
 */
import type { Rol } from '@backio/shared';
import { serviceClient, throwIf, type DbCtx } from '../db/client';
import { frontendOrigins } from '../../config/env';
import { emailHabilitado, plantillaHtml, sendEmail } from './email';

export interface Notificacion {
  tipo: string;
  titulo: string;
  cuerpo: string;
  ruta?: string; // ruta relativa en el frontend, ej. /proyectos/uuid
  entidad_tipo?: string;
  entidad_id?: string | null;
}

export interface Destino { usuarioIds?: string[]; roles?: Rol[] }

const MAX_INTENTOS = 5;

async function resolverDestinatarios(tenantId: string, d: Destino): Promise<{ id: string; email: string }[]> {
  const db = serviceClient();
  const out = new Map<string, string>();
  if (d.usuarioIds?.length) {
    const { data } = await db.from('usuarios').select('id, email').eq('tenant_id', tenantId).eq('activo', true).in('id', d.usuarioIds);
    for (const u of (data ?? []) as { id: string; email: string }[]) out.set(u.id, u.email);
  }
  if (d.roles?.length) {
    const { data } = await db.from('usuarios').select('id, email').eq('tenant_id', tenantId).eq('activo', true).in('rol', d.roles);
    for (const u of (data ?? []) as { id: string; email: string }[]) out.set(u.id, u.email);
  }
  return [...out.entries()].map(([id, email]) => ({ id, email }));
}

export async function notificar(ctx: Pick<DbCtx, 'tenantId'>, n: Notificacion, destino: Destino): Promise<number> {
  const destinatarios = await resolverDestinatarios(ctx.tenantId, destino);
  if (destinatarios.length === 0) return 0;
  const db = serviceClient();
  const { data, error } = await db
    .from('notificaciones')
    .insert(destinatarios.map((u) => ({
      tenant_id: ctx.tenantId, usuario_id: u.id, email_destino: u.email, canal: 'email',
      tipo: n.tipo, titulo: n.titulo, cuerpo: n.cuerpo + (n.ruta ? `\n__ruta__:${n.ruta}` : ''),
      entidad_tipo: n.entidad_tipo ?? null, entidad_id: n.entidad_id ?? null,
    })))
    .select('id');
  throwIf(error);
  // Envío inmediato en segundo plano; los fallos quedan para el reintento.
  void procesarPendientes(ctx.tenantId).catch(() => undefined);
  return (data ?? []).length;
}

interface Fila { id: string; tenant_id: string; email_destino: string | null; titulo: string; cuerpo: string; intentos: number }

export async function procesarPendientes(tenantId?: string): Promise<{ enviadas: number; fallidas: number }> {
  if (!emailHabilitado()) return { enviadas: 0, fallidas: 0 };
  const db = serviceClient();
  let q = db.from('notificaciones').select('id, tenant_id, email_destino, titulo, cuerpo, intentos').eq('canal', 'email').is('enviada_at', null).lt('intentos', MAX_INTENTOS).order('created_at').limit(50);
  if (tenantId) q = q.eq('tenant_id', tenantId);
  const { data, error } = await q;
  throwIf(error);
  let enviadas = 0, fallidas = 0;
  const base = frontendOrigins()[0] ?? '';
  for (const f of (data ?? []) as Fila[]) {
    if (!f.email_destino) { await db.from('notificaciones').update({ intentos: MAX_INTENTOS, ultimo_error: 'sin email' }).eq('id', f.id); continue; }
    const [cuerpo, ruta] = f.cuerpo.split('\n__ruta__:');
    try {
      await sendEmail({ to: f.email_destino, subject: `[BackIO] ${f.titulo}`, html: plantillaHtml(f.titulo, cuerpo ?? '', ruta ? `${base}${ruta}` : undefined), text: cuerpo });
      await db.from('notificaciones').update({ enviada_at: new Date().toISOString(), intentos: f.intentos + 1, ultimo_error: null }).eq('id', f.id);
      enviadas += 1;
    } catch (err) {
      await db.from('notificaciones').update({ intentos: f.intentos + 1, ultimo_error: err instanceof Error ? err.message.slice(0, 500) : String(err) }).eq('id', f.id);
      fallidas += 1;
    }
  }
  return { enviadas, fallidas };
}
