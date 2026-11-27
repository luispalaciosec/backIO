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
import { listClientes } from './db/clientes';
import { listUsuarios } from './db/usuarios';
import { cancelarReuniones, listReunionesDeOrigen, upsertReuniones } from './db/reuniones';
import { BasecampClient, type EventoBasecampSafe } from './basecamp/client';
import { log } from './logger';

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

/** Tarea programada: todas las fuentes. Google se suma en la fase 2. */
export async function sincronizarReuniones(ctx: DbCtx) {
  return { basecamp: await sincronizarReunionesBasecamp(ctx) };
}
