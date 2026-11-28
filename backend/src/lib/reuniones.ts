/**
 * Reuniones y visitas cuentan como trabajo (docs/23-reuniones.md, plan aprobado por Luis el 27/11/2026).
 *
 * Fuentes: el schedule de cada proyecto de Basecamp (esta fase) y el Google Calendar que cada persona conecte (fase 2).
 * Regla 1: de un evento solo entran horario, participantes y repetición; el texto se descarta en el cliente de la fuente.
 * Cuenta todo evento con hora (no los de todo el día). Si dos eventos se pisan, por persona y día se suma la unión de
 * los intervalos: un evento que está en Basecamp y en Google cuenta una vez.
 */
import { diaLocal, hoyLocal, sumarDias } from '@backio/shared';
import type { DbCtx, FilaInsert } from './db/client';
import { idsClientesDePrueba, listClientes } from './db/clientes';
import { listUsuarios } from './db/usuarios';
import { cancelarReuniones, listReunionesDeOrigen, listReunionesEntre, upsertReuniones } from './db/reuniones';
import { BasecampClient, type EventoBasecampSafe } from './basecamp/client';
import { log } from './logger';
import { audit } from './db/audit';
import { borrarGoogle, conectadosGoogle } from './db/google';
import { eventosGoogleSafe } from './google/calendar';
import { ErrorGoogle, googleConfigurado } from './google/oauth';

const DIAS_ATRAS = 45;
const DIAS_ADELANTE = 14; // las reuniones que vienen quitan capacidad a la semana
const OFFSET_MS = 5 * 3_600_000; // America/Guayaquil es UTC-5 todo el año (sin horario de verano)
const DIA_MS = 86_400_000;

export interface Ocurrencia {
  externo: string;
  inicio: string;
  fin: string;
}

/** Día (YYYY-MM-DD) y hora local (HH:MM:SS) de un instante, en Guayaquil. */
function partesLocales(iso: string): { dia: string; hora: string; diaSemana: number } {
  const d = new Date(Date.parse(iso) - OFFSET_MS);
  return { dia: d.toISOString().slice(0, 10), hora: d.toISOString().slice(11, 19), diaSemana: d.getUTCDay() };
}

const diaSemanaDe = (dia: string) => new Date(`${dia}T12:00:00Z`).getUTCDay();
const semanasEntre = (a: string, b: string) => Math.floor((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / (7 * DIA_MS));

/**
 * Ocurrencias de un evento dentro de [desde, hasta] (días locales, inclusive). Un evento que se repite da una
 * ocurrencia por día que le toca, con la misma hora y duración que el original; su id lleva la fecha.
 */
export function ocurrencias(ev: EventoBasecampSafe, desde: string, hasta: string): Ocurrencia[] {
  const ini = Date.parse(ev.inicio);
  const fin = Date.parse(ev.fin);
  if (!Number.isFinite(ini) || !Number.isFinite(fin) || fin <= ini || ev.todo_el_dia) return [];
  const base = partesLocales(ev.inicio);
  const duracion = fin - ini;
  if (!ev.repeticion) {
    return base.dia >= desde && base.dia <= hasta
      ? [{ externo: String(ev.id), inicio: new Date(ini).toISOString(), fin: new Date(fin).toISOString() }]
      : [];
  }
  const r = ev.repeticion;
  const primero = r.desde && r.desde > base.dia ? r.desde : base.dia;
  const ultimo = r.hasta && r.hasta < hasta ? r.hasta : hasta;
  const f = r.frecuencia.toLowerCase();
  const diasSemana = r.dias.length ? new Set(r.dias) : new Set([base.diaSemana]);
  const cada = f.includes('other') ? 2 : r.cada_semanas;
  const toca = (dia: string): boolean => {
    if (f.includes('day')) return true;
    if (f.includes('week')) return diasSemana.has(diaSemanaDe(dia)) && semanasEntre(base.dia, dia) % cada === 0;
    if (f.includes('month')) return dia.slice(8, 10) === base.dia.slice(8, 10);
    if (f.includes('year')) return dia.slice(5, 10) === base.dia.slice(5, 10);
    return dia === base.dia; // frecuencia desconocida: solo el original
  };
  const out: Ocurrencia[] = [];
  for (let dia = primero > desde ? primero : desde; dia <= ultimo; dia = sumarDias(dia, 1)) {
    if (dia < base.dia || !toca(dia)) continue;
    const i = Date.parse(`${dia}T${base.hora}-05:00`);
    out.push({ externo: `${ev.id}:${dia}`, inicio: new Date(i).toISOString(), fin: new Date(i + duracion).toISOString() });
  }
  return out;
}

/**
 * Horas de reunión por persona y día: la UNIÓN de sus intervalos (lo que se pisa cuenta una vez). Clave `persona|día`,
 * con el día del inicio de cada tramo en Guayaquil.
 */
/**
 * Horas de reunión por persona y cliente («usuario|cliente») en el período de las filas: la misma unión de horarios que
 * `horasDeReunion`, por cliente. Las internas (sin cliente) no entran.
 */
export function horasDeReunionPorCliente(
  filas: { usuario_id: string; cliente_id: string | null; inicio: string; fin: string }[],
): Map<string, number> {
  const porDia = horasDeReunion(filas.filter((f) => f.cliente_id).map((f) => ({ ...f, usuario_id: `${f.usuario_id}|${f.cliente_id}` })));
  const out = new Map<string, number>();
  for (const [k, h] of porDia) {
    const clave = k.slice(0, k.lastIndexOf('|'));
    out.set(clave, Math.round(((out.get(clave) ?? 0) + h) * 100) / 100);
  }
  return out;
}

export function horasDeReunion(filas: { usuario_id: string; inicio: string; fin: string }[]): Map<string, number> {
  const porPersona = new Map<string, [number, number][]>();
  for (const f of filas) {
    const a = Date.parse(f.inicio);
    const b = Date.parse(f.fin);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    const l = porPersona.get(f.usuario_id) ?? [];
    l.push([a, b]);
    porPersona.set(f.usuario_id, l);
  }
  const out = new Map<string, number>();
  for (const [u, l] of porPersona) {
    l.sort((x, y) => x[0] - y[0]);
    let [ini, fin] = l[0]!;
    const cerrar = () => {
      const k = `${u}|${diaLocal(new Date(ini).toISOString())}`;
      out.set(k, Math.round(((out.get(k) ?? 0) + (fin - ini) / 3_600_000) * 100) / 100);
    };
    for (const [a, b] of l.slice(1)) {
      if (a <= fin) fin = Math.max(fin, b);
      else {
        cerrar();
        [ini, fin] = [a, b];
      }
    }
    cerrar();
  }
  return out;
}

/**
 * Trae los eventos del schedule de cada proyecto de Basecamp con cliente: una fila por participante con usuario en
 * BackIO. Lo que ya no está se marca cancelado; el cliente asignado a mano se respeta.
 */
export async function sincronizarReunionesBasecamp(ctx: DbCtx): Promise<{
  proyectos: number;
  eventos: number;
  guardadas: number;
  canceladas: number;
  errores: number;
}> {
  const hoy = hoyLocal();
  const desde = sumarDias(hoy, -DIAS_ATRAS);
  const hasta = sumarDias(hoy, DIAS_ADELANTE);
  const clientes = (await listClientes(ctx)).filter((c) => c.basecamp_project_id);
  if (!clientes.length) return { proyectos: 0, eventos: 0, guardadas: 0, canceladas: 0, errores: 0 };
  const bc = await BasecampClient.forTenant(ctx.tenantId);
  const usuarios = await listUsuarios(ctx, { incluirInactivos: true });
  const porPersona = new Map(usuarios.filter((u) => u.basecamp_user_id).map((u) => [u.basecamp_user_id as number, u.id]));
  const existentes = await listReunionesDeOrigen(ctx.tenantId, 'basecamp', desde, hasta);
  const manual = new Map(existentes.filter((r) => r.asignacion === 'manual').map((r) => [`${r.usuario_id}|${r.externo_id}`, r.cliente_id]));

  const ahora = new Date().toISOString();
  const filas: FilaInsert<'reuniones'>[] = [];
  const vistas = new Set<string>();
  let proyectos = 0,
    eventos = 0,
    errores = 0;
  for (const c of clientes) {
    const pid = c.basecamp_project_id as number;
    try {
      const sched = (await bc.getDock(pid)).find((d) => d.name === 'schedule' && d.enabled);
      if (!sched) continue;
      proyectos += 1;
      for (const ev of await bc.scheduleEntriesSafe(pid, sched.id)) {
        for (const oc of ocurrencias(ev, desde, hasta)) {
          eventos += 1;
          for (const bcId of ev.participantes) {
            const usuario = porPersona.get(bcId);
            if (!usuario) continue;
            const clave = `${usuario}|${oc.externo}`;
            if (vistas.has(clave)) continue;
            vistas.add(clave);
            const aMano = manual.has(clave);
            filas.push({
              tenant_id: ctx.tenantId,
              usuario_id: usuario,
              origen: 'basecamp',
              externo_id: oc.externo,
              inicio: oc.inicio,
              fin: oc.fin,
              fecha: diaLocal(oc.inicio),
              horas: Math.round(((Date.parse(oc.fin) - Date.parse(oc.inicio)) / 3_600_000) * 100) / 100,
              cliente_id: aMano ? (manual.get(clave) ?? null) : c.id,
              asignacion: aMano ? 'manual' : 'proyecto',
              dominios_externos: [],
              respuesta: 'aceptada',
              cancelada: false,
              sincronizado_at: ahora,
            });
          }
        }
      }
    } catch (e) {
      errores += 1;
      log.warn('[reuniones] schedule de Basecamp sin leer', { cliente: c.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const guardadas = await upsertReuniones(filas);
  // Solo se cancela lo que desapareció si todos los proyectos se pudieron leer: un error no borra reuniones reales.
  const sobran = errores ? [] : existentes.filter((r) => !r.cancelada && !vistas.has(`${r.usuario_id}|${r.externo_id}`)).map((r) => r.id);
  await cancelarReuniones(sobran);
  return { proyectos, eventos, guardadas, canceladas: sobran.length, errores };
}

/** Cliente de una reunión por los dominios de sus invitados externos (`clientes.dominios_correo`). Sin coincidencia: interna. */
export function clientePorDominio(dominios: string[], porDominio: Map<string, string>): string | null {
  for (const d of dominios) {
    const c = porDominio.get(d.toLowerCase());
    if (c) return c;
  }
  return null;
}

/**
 * Trae el Google Calendar de cada persona que lo conectó (fase 2, migración 55). Cuenta todo evento con hora que la
 * persona no rechazó. El cliente sale del dominio de los invitados; el asignado a mano se respeta. Si el permiso de
 * Google ya no sirve, se borra la conexión y la persona ve «Reconectar» en Mi Google Calendar.
 */
export async function sincronizarReunionesGoogle(
  ctx: DbCtx,
): Promise<{ personas: number; guardadas: number; canceladas: number; desconectadas: number; errores: number }> {
  if (!googleConfigurado()) return { personas: 0, guardadas: 0, canceladas: 0, desconectadas: 0, errores: 0 };
  const conectados = await conectadosGoogle(ctx.tenantId);
  if (!conectados.length) return { personas: 0, guardadas: 0, canceladas: 0, desconectadas: 0, errores: 0 };
  const hoy = hoyLocal();
  const desde = sumarDias(hoy, -DIAS_ATRAS);
  const hasta = sumarDias(hoy, DIAS_ADELANTE);
  const porDominio = new Map<string, string>();
  for (const c of await listClientes(ctx)) for (const d of c.dominios_correo ?? []) porDominio.set(d.trim().toLowerCase(), c.id);
  const ahora = new Date().toISOString();
  let guardadas = 0,
    canceladas = 0,
    desconectadas = 0,
    errores = 0;
  for (const p of conectados) {
    try {
      const eventos = await eventosGoogleSafe(p.usuario_id, p.email, `${desde}T05:00:00Z`, `${sumarDias(hasta, 1)}T05:00:00Z`);
      if (!eventos) continue;
      const existentes = await listReunionesDeOrigen(ctx.tenantId, 'google', desde, hasta, p.usuario_id);
      const manual = new Map(existentes.filter((r) => r.asignacion === 'manual').map((r) => [r.externo_id, r.cliente_id]));
      const vistas = new Set<string>();
      const filas: FilaInsert<'reuniones'>[] = [];
      for (const e of eventos) {
        if (e.todo_el_dia || e.cancelado || e.respuesta === 'rechazada') continue;
        const horas = Math.round(((Date.parse(e.fin) - Date.parse(e.inicio)) / 3_600_000) * 100) / 100;
        if (!(horas > 0)) continue;
        vistas.add(e.id);
        const aMano = manual.has(e.id);
        const cliente = aMano ? (manual.get(e.id) ?? null) : clientePorDominio(e.dominios_externos, porDominio);
        filas.push({
          tenant_id: ctx.tenantId,
          usuario_id: p.usuario_id,
          origen: 'google',
          externo_id: e.id,
          inicio: new Date(e.inicio).toISOString(),
          fin: new Date(e.fin).toISOString(),
          fecha: diaLocal(e.inicio),
          horas,
          cliente_id: cliente,
          asignacion: aMano ? 'manual' : cliente ? 'dominio' : null,
          dominios_externos: e.dominios_externos,
          respuesta: e.respuesta,
          cancelada: false,
          sincronizado_at: ahora,
        });
      }
      guardadas += await upsertReuniones(filas);
      const sobran = existentes.filter((r) => !r.cancelada && !vistas.has(r.externo_id)).map((r) => r.id);
      await cancelarReuniones(sobran);
      canceladas += sobran.length;
    } catch (e) {
      if (e instanceof ErrorGoogle && e.revocado) {
        desconectadas += 1;
        await borrarGoogle(p.usuario_id);
        await audit(ctx, { accion: 'google_desconectado', entidad: 'usuario', entidad_id: p.usuario_id, detalle: { motivo: e.codigo } });
      } else {
        errores += 1;
        log.warn('[reuniones] calendario de Google sin leer', { usuario: p.usuario_id, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  return { personas: conectados.length, guardadas, canceladas, desconectadas, errores };
}

/** Horas de reunión de un período: total, por persona (unión de horarios por día) y por cliente. Pura. */
export function resumirReuniones(
  filas: { usuario_id: string; cliente_id: string | null; inicio: string; fin: string }[],
  opciones: { excluir?: Set<string>; clienteIds?: string[] } = {},
): { total: number; por_usuario: Record<string, number>; por_cliente: Record<string, number> } {
  const alcance = opciones.clienteIds ? new Set(opciones.clienteIds) : null;
  // Con alcance (una mesa) solo cuentan las reuniones con sus clientes; sin alcance, también las internas.
  const validas = filas.filter(
    (f) => !(f.cliente_id && opciones.excluir?.has(f.cliente_id)) && (!alcance || (f.cliente_id && alcance.has(f.cliente_id))),
  );
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const por_usuario: Record<string, number> = {};
  for (const [k, h] of horasDeReunion(validas)) {
    const u = k.slice(0, k.indexOf('|'));
    por_usuario[u] = r2((por_usuario[u] ?? 0) + h);
  }
  const por_cliente: Record<string, number> = {};
  for (const [k, h] of horasDeReunionPorCliente(validas)) {
    const c = k.slice(k.indexOf('|') + 1);
    por_cliente[c] = r2((por_cliente[c] ?? 0) + h);
  }
  return { total: r2(Object.values(por_usuario).reduce((s, h) => s + h, 0)), por_usuario, por_cliente };
}

/** Reuniones de una semana por cliente, con quién estuvo, para el weekly (docs/23, fase 3). */
export async function reunionesDeSemana(
  ctx: DbCtx,
  semana: { fecha_inicio: string; fecha_fin: string },
  clienteIds?: string[],
): Promise<{
  total: number;
  internas: number;
  clientes: { cliente_id: string; horas: number; personas: { usuario_id: string; horas: number }[] }[];
}> {
  const [filas, prueba] = await Promise.all([listReunionesEntre(ctx, semana.fecha_inicio, semana.fecha_fin), idsClientesDePrueba(ctx)]);
  const validas = filas.filter((f) => !(f.cliente_id && prueba.has(f.cliente_id)));
  const conClientes = resumirReuniones(validas, { clienteIds });
  const porCliente = new Map<string, { usuario_id: string; horas: number }[]>();
  for (const [k, h] of horasDeReunionPorCliente(validas)) {
    const [usuario_id, cliente_id] = k.split('|') as [string, string];
    if (clienteIds && !clienteIds.includes(cliente_id)) continue;
    porCliente.set(cliente_id, [...(porCliente.get(cliente_id) ?? []), { usuario_id, horas: h }]);
  }
  const internas = clienteIds ? 0 : resumirReuniones(validas.filter((f) => !f.cliente_id)).total;
  return {
    total: Math.round(Object.values(conClientes.por_cliente).reduce((s, h) => s + h, 0) * 100) / 100,
    internas,
    clientes: [...porCliente.entries()]
      .map(([cliente_id, personas]) => ({
        cliente_id,
        horas: conClientes.por_cliente[cliente_id] ?? 0,
        personas: personas.sort((a, b) => b.horas - a.horas),
      }))
      .sort((a, b) => b.horas - a.horas),
  };
}

/** Tarea programada: todas las fuentes. */
export async function sincronizarReuniones(ctx: DbCtx) {
  return { basecamp: await sincronizarReunionesBasecamp(ctx), google: await sincronizarReunionesGoogle(ctx) };
}
