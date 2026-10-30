/**
 * Notificaciones: se encolan en la tabla y se envían por correo (canal decidido: correo).
 * `notificar` inserta una fila por destinatario e intenta enviar de inmediato; lo que falle
 * lo reintenta el scheduler (procesarPendientes) hasta 5 veces.
 */
import type { Rol } from '@backio/shared';
import type { DbCtx } from '../db/client';
import {
  correosDeUsuarios,
  descartarNotificacion,
  insertarNotificaciones,
  listarNotificacionesPendientes,
  marcarNotificacionEnviada,
  registrarErrorNotificacion,
  reservarNotificacion,
  usuariosActivosPorId,
  usuariosActivosPorRol,
} from '../db/notificaciones';
import { frontendOrigins } from '../../config/env';
import { emailHabilitado, plantillaHtml, sendEmail } from './email';
import { log } from '../logger';

export interface Notificacion {
  tipo: string;
  titulo: string;
  cuerpo: string;
  ruta?: string; // ruta relativa en el frontend, ej. /proyectos/uuid
  entidad_tipo?: string;
  entidad_id?: string | null;
}

export interface Destino {
  usuarioIds?: string[];
  roles?: Rol[];
}

const MAX_INTENTOS = 5;

async function resolverDestinatarios(tenantId: string, d: Destino): Promise<{ id: string; email: string }[]> {
  const out = new Map<string, string>();
  if (d.usuarioIds?.length) {
    for (const u of await usuariosActivosPorId(tenantId, d.usuarioIds)) out.set(u.id, u.email);
  }
  if (d.roles?.length) {
    for (const u of await usuariosActivosPorRol(tenantId, d.roles)) out.set(u.id, u.email);
  }
  return [...out.entries()].map(([id, email]) => ({ id, email }));
}

/**
 * Botón «Abrir en BackIO» de los correos (auditoría 10/10, S5). La ruta viaja al final del cuerpo tras una marca;
 * cualquier aparición de la marca en el texto (p. ej. dentro del título de una tarea copiado a una señal) se
 * neutraliza al encolar, se lee solo la última y además debe empezar por una sección conocida de BackIO.
 */
const MARCA_RUTA = '\n__ruta__:';
const RUTAS_PERMITIDAS = [
  '/proyectos',
  '/backlog',
  '/weekly',
  '/daily',
  '/informes',
  '/kpis',
  '/dashboard',
  '/personas',
  '/dia-a-dia',
  '/huerfanos',
  '/evolutivo',
  '/clientes',
  '/mi-dia',
  '/admin/',
];
const sinMarca = (t: string) => t.replace(/__ruta__:/g, '__ruta:');
export function rutaPermitida(ruta: string | undefined | null): string | undefined {
  if (!ruta || !/^\/(?!\/)[A-Za-z0-9_\-./?=&%]*$/.test(ruta)) return undefined;
  return RUTAS_PERMITIDAS.some((p) => ruta === p || ruta.startsWith(p.endsWith('/') ? p : `${p}/`) || ruta.startsWith(`${p}?`))
    ? ruta
    : undefined;
}
export function separarRuta(cuerpo: string): { cuerpo: string; ruta: string | undefined } {
  const i = cuerpo.lastIndexOf(MARCA_RUTA);
  if (i < 0) return { cuerpo, ruta: undefined };
  return { cuerpo: cuerpo.slice(0, i), ruta: rutaPermitida(cuerpo.slice(i + MARCA_RUTA.length)) };
}

/**
 * Guarda el aviso para cada destinatario: aparece en su campana de BackIO y, salvo `soloCampana`, sale por correo
 * (canal 'email'). `soloCampana` usa el canal 'pendiente', que el envío de correos no toma (p. ej. quien desactivó el
 * correo de «Mi día»).
 */
export async function notificar(
  ctx: Pick<DbCtx, 'tenantId'>,
  n: Notificacion,
  destino: Destino,
  opts: { soloCampana?: boolean } = {},
): Promise<number> {
  const destinatarios = await resolverDestinatarios(ctx.tenantId, destino);
  if (destinatarios.length === 0) return 0;
  const data = await insertarNotificaciones(
    destinatarios.map((u) => ({
      tenant_id: ctx.tenantId,
      usuario_id: u.id,
      email_destino: u.email,
      canal: opts.soloCampana ? 'pendiente' : 'email',
      tipo: n.tipo,
      titulo: sinMarca(n.titulo),
      cuerpo: sinMarca(n.cuerpo) + (rutaPermitida(n.ruta) ? `${MARCA_RUTA}${n.ruta}` : ''),
      entidad_tipo: n.entidad_tipo ?? null,
      entidad_id: n.entidad_id ?? null,
    })),
  );
  // Envío inmediato en segundo plano; los fallos quedan para el reintento.
  if (!opts.soloCampana) void procesarPendientes(ctx.tenantId).catch(() => undefined);
  return data.length;
}

interface Fila {
  id: string;
  tenant_id: string;
  usuario_id: string | null;
  email_destino: string | null;
  titulo: string;
  cuerpo: string;
  intentos: number;
}

export async function procesarPendientes(tenantId?: string): Promise<{ enviadas: number; fallidas: number }> {
  if (!emailHabilitado()) return { enviadas: 0, fallidas: 0 };
  const data = await listarNotificacionesPendientes(MAX_INTENTOS, tenantId);
  let enviadas = 0,
    fallidas = 0;
  const base = frontendOrigins()[0] ?? '';
  const filas = data as Fila[];
  // El destinatario es SIEMPRE el correo actual del usuario dueño de la fila (mismo tenant), nunca email_destino:
  // el dueño puede editar su fila por PostgREST y así convertía BackIO en un relay de correos (auditoría run-1).
  const ids = [...new Set(filas.map((f) => f.usuario_id).filter((x): x is string => !!x))];
  const correos = new Map<string, { email: string | null; tenant_id: string; activo: boolean }>();
  if (ids.length) {
    for (const u of await correosDeUsuarios(ids)) correos.set(u.id, u);
  }
  for (const f of filas) {
    const u = f.usuario_id ? correos.get(f.usuario_id) : undefined;
    const destino = u && u.activo && u.tenant_id === f.tenant_id ? u.email : null;
    if (!destino) {
      await descartarNotificacion(f.id, MAX_INTENTOS);
      continue;
    }
    if (f.email_destino && f.email_destino.trim().toLowerCase() !== destino.trim().toLowerCase())
      log.warn('[notificaciones] email_destino no coincide con el usuario; se envía al correo del usuario', f.id);
    const { cuerpo, ruta } = separarRuta(f.cuerpo);
    // Reserva atómica antes de enviar: solo el proceso que logra subir `intentos` de N a N+1 manda el correo. Si
    // coinciden el scheduler y un disparo externo de /api/cron, el otro no encuentra la fila y la salta.
    const reservada = await reservarNotificacion(f.id, f.intentos);
    if (!reservada?.length) continue;
    try {
      await sendEmail({
        to: destino,
        subject: `[BackIO] ${f.titulo.replace(/[\r\n]+/g, ' ')}`,
        html: plantillaHtml(f.titulo, cuerpo ?? '', ruta ? `${base}${ruta}` : undefined),
        text: cuerpo,
      });
      await marcarNotificacionEnviada(f.id);
      enviadas += 1;
    } catch (err) {
      await registrarErrorNotificacion(f.id, err instanceof Error ? err.message.slice(0, 500) : String(err));
      fallidas += 1;
    }
  }
  return { enviadas, fallidas };
}
