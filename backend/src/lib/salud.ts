/**
 * Salud del sistema (Admin → Servicios): estado y latencia de cada servicio del que depende BackIO.
 * Solo estado y milisegundos; sin detalle interno de errores hacia el cliente.
 */
import { env, frontendOrigins } from '../config/env';
import { MODELO_IA } from './ia';
import { pingBase, pingTenant, ultimaCorridaDe } from './db/salud';
import { getStatus } from './basecamp/oauth';
import { BasecampClient } from './basecamp/client';
import { JOBS } from './jobs';
import { log } from './logger';
import { ultimasCorridas } from './db/cron_runs';

export type EstadoServicio = 'ok' | 'degradado' | 'caido' | 'no_configurado';
export interface Servicio {
  id: string;
  nombre: string;
  estado: EstadoServicio;
  latencia_ms: number | null;
  detalle: string | null;
}

const TIMEOUT_MS = 7000;
async function medir(id: string, nombre: string, fn: (signal: AbortSignal) => Promise<string | null | void>): Promise<Servicio> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const detalle = (await fn(ctl.signal)) ?? null;
    const ms = Date.now() - t0;
    return { id, nombre, estado: ms > 3000 ? 'degradado' : 'ok', latencia_ms: ms, detalle };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'no_configurado')
      return { id, nombre, estado: 'no_configurado', latencia_ms: null, detalle: 'Sin credenciales configuradas' };
    return {
      id,
      nombre,
      estado: 'caido',
      latencia_ms: Date.now() - t0,
      detalle: /abort/i.test(msg) ? 'Sin respuesta (timeout)' : 'No responde',
    };
  } finally {
    clearTimeout(t);
  }
}
const esperar = async (res: Response, ok: (s: number) => boolean = (s) => s < 500) => {
  if (!ok(res.status)) throw new Error(`HTTP ${res.status}`);
};

export interface EstadoJob {
  nombre: string;
  descripcion: string;
  ultima_at: string | null;
  /** al_dia · con_errores (la última corrida terminó con error) · sin_correr (nunca o demasiado atrasado) · sin_registro */
  estado: 'al_dia' | 'con_errores' | 'sin_correr' | 'sin_registro';
}

/** Última corrida de cada job programado (cron_runs). El vigía avisa por correo; esto es para mirarlo en pantalla. */
export async function estadoJobs(ahoraMs = Date.now()): Promise<EstadoJob[]> {
  const ultimas = await ultimasCorridas();
  return JOBS.filter((j) => j.registrar !== false).map((j) => {
    const u = ultimas.get(j.nombre);
    if (!u) return { nombre: j.nombre, descripcion: j.descripcion, ultima_at: null, estado: 'sin_registro' as const };
    const atrasado = j.intervaloMin !== undefined && ahoraMs - Date.parse(u.inicio_at) > Math.max(3 * j.intervaloMin, 90) * 60_000;
    return {
      nombre: j.nombre,
      descripcion: j.descripcion,
      ultima_at: u.inicio_at,
      estado: atrasado ? ('sin_correr' as const) : u.ok === false ? ('con_errores' as const) : ('al_dia' as const),
    };
  });
}

export async function verificarSalud(
  tenantId: string,
): Promise<{ verificado_at: string; todo_ok: boolean; servicios: Servicio[]; jobs: EstadoJob[] }> {
  const e = env();
  const servicios = await Promise.all([
    medir('railway', 'Railway (API BackIO)', async () => `Node ${process.version} · ${Math.round(process.uptime() / 60)} min activo`),
    medir('vercel', 'Vercel (frontend)', async (signal) => {
      const url = frontendOrigins()[0];
      if (!url) throw new Error('no_configurado');
      await esperar(await fetch(`${url}/login`, { signal, redirect: 'manual' }));
      return url;
    }),
    medir('supabase_db', 'Supabase DB', async (signal) => {
      await pingTenant(tenantId, signal);
    }),
    medir('supabase_auth', 'Supabase Auth', async (signal) => {
      await esperar(await fetch(`${e.SUPABASE_URL}/auth/v1/health`, { signal, headers: { apikey: e.SUPABASE_ANON_KEY } }));
    }),
    medir('basecamp', 'Basecamp', async () => {
      const st = await getStatus(tenantId);
      if (!st.conectado) throw new Error('no_configurado');
      const bc = await BasecampClient.forTenant(tenantId);
      await bc.request<unknown>('GET', '/my/profile.json');
      return st.cuenta ?? null;
    }),
    medir('resend', 'Resend (correo)', async (signal) => {
      const k = process.env.RESEND_API_KEY;
      if (!k) throw new Error('no_configurado');
      await esperar(await fetch('https://api.resend.com/domains', { signal, headers: { Authorization: `Bearer ${k}` } }), (s) => s === 200);
      return process.env.EMAIL_FROM ?? null;
    }),
    medir('anthropic', 'Anthropic (IA)', async (signal) => {
      const k = e.ANTHROPIC_API_KEY;
      if (!k) throw new Error('no_configurado');
      await esperar(
        await fetch('https://api.anthropic.com/v1/models?limit=1', {
          signal,
          headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01' },
        }),
        (s) => s === 200,
      );
      return MODELO_IA;
    }),
    medir('prometio', 'PrometIO', async (signal) => {
      const url = process.env.PROMETIO_URL ?? 'https://prometio-backend-production.up.railway.app';
      await esperar(await fetch(`${url}/health`, { signal }), (s) => s === 200);
      return e.PROMETIO_WEBHOOK_SECRET ? 'webhook configurado' : 'sin secreto de webhook';
    }),
  ]);
  const jobs = await estadoJobs().catch((err) => {
    log.error('[salud] estado de jobs', err);
    return [];
  });
  return {
    verificado_at: new Date().toISOString(),
    todo_ok: servicios.every((s) => s.estado === 'ok' || s.estado === 'no_configurado'),
    servicios,
    jobs,
  };
}

/**
 * Chequeo profundo para un monitor externo (`GET /health/profundo`). `/health` solo dice que el proceso está prendido:
 * el 27/10/2026 respondió «ok» durante 14 horas mientras la API de la base de Supabase no daba conexiones (PGRST003) y
 * BackIO no cargaba nada. El vigía no avisó porque registra y encola sus correos en esa misma base.
 *
 * Mira dos cosas, cada una con límite de tiempo: que la base responda y que la reconciliación con Basecamp (cada 30
 * min) haya corrido hace menos de 75 min. Es público: no devuelve detalle interno. Se guarda 30 s para que un monitor
 * consultando cada minuto no cargue la base.
 */
export interface SaludProfunda {
  ok: boolean;
  base: 'ok' | 'lenta' | 'caida';
  tareas: 'ok' | 'atrasadas' | 'desconocido';
  ts: string;
}
export const LIMITE_BASE_MS = 5000;
export const RECONCILIACION_MAX_MIN = 75;
let cache: { valor: SaludProfunda; hasta: number } | null = null;

export async function saludProfunda(ahoraMs = Date.now(), deps = { pingBase, ultimaCorridaDe }): Promise<SaludProfunda> {
  if (cache && cache.hasta > ahoraMs) return cache.valor;
  const conLimite = async <T>(fn: (s: AbortSignal) => Promise<T>): Promise<T> => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), LIMITE_BASE_MS);
    try {
      return await Promise.race([
        fn(ctl.signal),
        new Promise<never>((_, rej) => ctl.signal.addEventListener('abort', () => rej(new Error('timeout')))),
      ]);
    } finally {
      clearTimeout(t);
    }
  };
  let base: SaludProfunda['base'] = 'ok';
  const t0 = Date.now();
  try {
    await conLimite((s) => deps.pingBase(s));
    if (Date.now() - t0 > 2000) base = 'lenta';
  } catch (err) {
    base = 'caida';
    log.error('[salud profunda] la base no responde', err instanceof Error ? err.message : err);
  }
  let tareas: SaludProfunda['tareas'] = 'desconocido';
  if (base !== 'caida') {
    try {
      const ultima = await conLimite((s) => deps.ultimaCorridaDe('reconcile', s));
      tareas = ultima && ahoraMs - Date.parse(ultima) <= RECONCILIACION_MAX_MIN * 60_000 ? 'ok' : 'atrasadas';
    } catch {
      tareas = 'desconocido';
    }
  }
  const valor: SaludProfunda = { ok: base !== 'caida' && tareas !== 'atrasadas', base, tareas, ts: new Date(ahoraMs).toISOString() };
  cache = { valor, hasta: ahoraMs + 30_000 };
  return valor;
}

/** Solo para tests. */
export function limpiarCacheSalud(): void {
  cache = null;
}
