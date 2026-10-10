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

/**
 * Botón «Abrir en BackIO» de los correos (auditoría 10/10, S5). La ruta viaja al final del cuerpo tras una marca;
 * cualquier aparición de la marca en el texto (p. ej. dentro del título de una tarea copiado a una señal) se
 * neutraliza al encolar, se lee solo la última y además debe empezar por una sección conocida de BackIO.
 */
const MARCA_RUTA = '\n__ruta__:';
const RUTAS_PERMITIDAS = ['/proyectos', '/backlog', '/weekly', '/daily', '/informes', '/kpis', '/dashboard', '/personas', '/dia-a-dia', '/huerfanos', '/evolutivo', '/admin/'];
const sinMarca = (t: string) => t.replace(/__ruta__:/g, '__ruta:');
export function rutaPermitida(ruta: string | undefined | null): string | undefined {
  if (!ruta || !/^\/(?!\/)[A-Za-z0-9_\-./?=&%]*$/.test(ruta)) return undefined;
  return RUTAS_PERMITIDAS.some((p) => ruta === p || ruta.startsWith(p.endsWith('/') ? p : `${p}/`) || ruta.startsWith(`${p}?`)) ? ruta : undefined;
}
export function separarRuta(cuerpo: string): { cuerpo: string; ruta: string | undefined } {
  const i = cuerpo.lastIndexOf(MARCA_RUTA);
  if (i < 0) return { cuerpo, ruta: undefined };
  return { cuerpo: cuerpo.slice(0, i), ruta: rutaPermitida(cuerpo.slice(i + MARCA_RUTA.length)) };
}

export async function notificar(ctx: Pick<DbCtx, 'tenantId'>, n: Notificacion, destino: Destino): Promise<number> {
  const destinatarios = await resolverDestinatarios(ctx.tenantId, destino);
  if (destinatarios.length === 0) return 0;
  const db = serviceClient();
  const { data, error } = await db
    .from('notificaciones')
    .insert(destinatarios.map((u) => ({
      tenant_id: ctx.tenantId, usuario_id: u.id, email_destino: u.email, canal: 'email',
      tipo: n.tipo, titulo: sinMarca(n.titulo), cuerpo: sinMarca(n.cuerpo) + (rutaPermitida(n.ruta) ? `${MARCA_RUTA}${n.ruta}` : ''),
      entidad_tipo: n.entidad_tipo ?? null, entidad_id: n.entidad_id ?? null,
    })))
    .select('id');
  throwIf(error);
  // Envío inmediato en segundo plano; los fallos quedan para el reintento.
  void procesarPendientes(ctx.tenantId).catch(() => undefined);
  return (data ?? []).length;
}

interface Fila { id: string; tenant_id: string; usuario_id: string | null; email_destino: string | null; titulo: string; cuerpo: string; intentos: number }

export async function procesarPendientes(tenantId?: string): Promise<{ enviadas: number; fallidas: number }> {
  if (!emailHabilitado()) return { enviadas: 0, fallidas: 0 };
  const db = serviceClient();
  let q = db.from('notificaciones').select('id, tenant_id, usuario_id, email_destino, titulo, cuerpo, intentos').eq('canal', 'email').is('enviada_at', null).lt('intentos', MAX_INTENTOS).order('created_at').limit(50);
  if (tenantId) q = q.eq('tenant_id', tenantId);
  const { data, error } = await q;
  throwIf(error);
  let enviadas = 0, fallidas = 0;
  const base = frontendOrigins()[0] ?? '';
  const filas = (data ?? []) as Fila[];
  // El destinatario es SIEMPRE el correo actual del usuario dueño de la fila (mismo tenant), nunca email_destino:
  // el dueño puede editar su fila por PostgREST y así convertía BackIO en un relay de correos (auditoría run-1).
  const ids = [...new Set(filas.map((f) => f.usuario_id).filter((x): x is string => !!x))];
  const correos = new Map<string, { email: string | null; tenant_id: string; activo: boolean }>();
  if (ids.length) {
    const { data: us, error: e2 } = await db.from('usuarios').select('id, email, tenant_id, activo').in('id', ids);
    throwIf(e2);
    for (const u of (us ?? []) as { id: string; email: string | null; tenant_id: string; activo: boolean }[]) correos.set(u.id, u);
  }
  for (const f of filas) {
    const u = f.usuario_id ? correos.get(f.usuario_id) : undefined;
    const destino = u && u.activo && u.tenant_id === f.tenant_id ? u.email : null;
    if (!destino) { await db.from('notificaciones').update({ intentos: MAX_INTENTOS, ultimo_error: 'sin destinatario válido' }).eq('id', f.id); continue; }
    if (f.email_destino && f.email_destino.trim().toLowerCase() !== destino.trim().toLowerCase()) console.warn('[notificaciones] email_destino no coincide con el usuario; se envía al correo del usuario', f.id);
    const { cuerpo, ruta } = separarRuta(f.cuerpo);
    try {
      await sendEmail({ to: destino, subject: `[BackIO] ${f.titulo.replace(/[\r\n]+/g, ' ')}`, html: plantillaHtml(f.titulo, cuerpo ?? '', ruta ? `${base}${ruta}` : undefined), text: cuerpo });
      await db.from('notificaciones').update({ enviada_at: new Date().toISOString(), intentos: f.intentos + 1, ultimo_error: null }).eq('id', f.id);
      enviadas += 1;
    } catch (err) {
      await db.from('notificaciones').update({ intentos: f.intentos + 1, ultimo_error: err instanceof Error ? err.message.slice(0, 500) : String(err) }).eq('id', f.id);
      fallidas += 1;
    }
  }
  return { enviadas, fallidas };
}
