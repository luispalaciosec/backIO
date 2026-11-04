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
import { emailHabilitado, plantillaHtml, sendEmail, textoPlano, type CorreoRico } from './email';
import { log } from '../logger';

export interface Notificacion {
  tipo: string;
  titulo: string;
  cuerpo: string;
  ruta?: string; // ruta relativa en el frontend, ej. /proyectos/uuid
  entidad_tipo?: string;
  entidad_id?: string | null;
  /** Bloques del correo. La campana sigue mostrando `cuerpo`, que debe poder leerse solo. */
  correo?: CorreoRico;
}

export interface Destino {
  usuarioIds?: string[];
  roles?: Rol[];
}

const MAX_INTENTOS = 5;

/** Texto del botón del correo según el aviso: dice qué se va a hacer, no «abrir». */
const ACCION_POR_TIPO: Record<string, string> = {
  mi_dia: 'Abrir Mi día',
  agenda_weekly: 'Abrir el weekly',
  riesgo_semana: 'Ver el riesgo en el weekly',
  informe_mensual: 'Revisar el informe',
  borrador_proyecto: 'Revisar el borrador',
  espera_cliente: 'Ver la cuenta',
  salud_cliente: 'Ver la cuenta',
  proyecto_asignado: 'Ver el proyecto',
  recurrencia_generada: 'Revisar el proyecto',
  huerfanos: 'Resolver huérfanos',
  job_sin_correr: 'Ver tareas programadas',
  alerta_api_key: 'Revisar API keys',
};

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
const MARCA_CORREO = '\n__correo__:';
const sinMarca = (t: string) => t.replace(/__ruta__:/g, '__ruta:').replace(/__correo__:/g, '__correo:');
export function rutaPermitida(ruta: string | undefined | null): string | undefined {
  if (!ruta || !/^\/(?!\/)[A-Za-z0-9_\-./?=&%]*$/.test(ruta)) return undefined;
  return RUTAS_PERMITIDAS.some((p) => ruta === p || ruta.startsWith(p.endsWith('/') ? p : `${p}/`) || ruta.startsWith(`${p}?`))
    ? ruta
    : undefined;
}
export function separarRuta(guardado: string): { cuerpo: string; ruta: string | undefined; correo?: CorreoRico } {
  const i = guardado.lastIndexOf(MARCA_RUTA);
  const ruta = i < 0 ? undefined : rutaPermitida(guardado.slice(i + MARCA_RUTA.length));
  const resto = i < 0 ? guardado : guardado.slice(0, i);
  // Los bloques viajan en la misma fila, tras su marca. Si no se pueden leer, el correo sale con el texto normal.
  const j = resto.lastIndexOf(MARCA_CORREO);
  if (j < 0) return { cuerpo: resto, ruta };
  return { cuerpo: resto.slice(0, j), ruta, correo: leerCorreo(resto.slice(j + MARCA_CORREO.length)) };
}
function leerCorreo(json: string): CorreoRico | undefined {
  try {
    const c = JSON.parse(json) as CorreoRico | null;
    return c && Array.isArray(c.secciones) ? c : undefined;
  } catch {
    return undefined;
  }
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
      cuerpo:
        sinMarca(n.cuerpo) +
        // Solo si sale por correo: en la campana no se usan. JSON escapa los saltos de línea, así que no puede fingir una marca.
        (n.correo && !opts.soloCampana ? `${MARCA_CORREO}${sinMarca(JSON.stringify(n.correo))}` : '') +
        (rutaPermitida(n.ruta) ? `${MARCA_RUTA}${n.ruta}` : ''),
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
  tipo: string | null;
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
    const { cuerpo, ruta, correo } = separarRuta(f.cuerpo);
    // Reserva atómica antes de enviar: solo el proceso que logra subir `intentos` de N a N+1 manda el correo. Si
    // coinciden el scheduler y un disparo externo de /api/cron, el otro no encuentra la fila y la salta.
    const reservada = await reservarNotificacion(f.id, f.intentos);
    if (!reservada?.length) continue;
    const url = ruta ? `${base}${ruta}` : undefined;
    try {
      await sendEmail({
        to: destino,
        // Sin «[BackIO]»: el remitente ya lo dice y le quitaba espacio al asunto en el celular.
        subject: f.titulo.replace(/[\r\n]+/g, ' '),
        html: plantillaHtml(f.titulo, cuerpo ?? '', url, { accion: ACCION_POR_TIPO[f.tipo ?? ''], correo }),
        text: textoPlano(f.titulo, cuerpo ?? '', correo, url),
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
