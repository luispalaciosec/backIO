/**
 * Salud del sistema (Admin → Servicios): estado y latencia de cada servicio del que depende BackIO.
 * Solo estado y milisegundos; sin detalle interno de errores hacia el cliente.
 */
import { env, frontendOrigins } from '../config/env';
import { serviceClient } from './db/client';
import { getStatus } from './basecamp/oauth';
import { BasecampClient } from './basecamp/client';

export type EstadoServicio = 'ok' | 'degradado' | 'caido' | 'no_configurado';
export interface Servicio { id: string; nombre: string; estado: EstadoServicio; latencia_ms: number | null; detalle: string | null }

const TIMEOUT_MS = 7000;
async function medir(id: string, nombre: string, fn: (signal: AbortSignal) => Promise<string | null | void>): Promise<Servicio> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), TIMEOUT_MS); const t0 = Date.now();
  try {
    const detalle = (await fn(ctl.signal)) ?? null;
    const ms = Date.now() - t0;
    return { id, nombre, estado: ms > 3000 ? 'degradado' : 'ok', latencia_ms: ms, detalle };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'no_configurado') return { id, nombre, estado: 'no_configurado', latencia_ms: null, detalle: 'Sin credenciales configuradas' };
    return { id, nombre, estado: 'caido', latencia_ms: Date.now() - t0, detalle: /abort/i.test(msg) ? 'Sin respuesta (timeout)' : 'No responde' };
  } finally { clearTimeout(t); }
}
const esperar = async (res: Response, ok: (s: number) => boolean = (s) => s < 500) => { if (!ok(res.status)) throw new Error(`HTTP ${res.status}`); };

export async function verificarSalud(tenantId: string): Promise<{ verificado_at: string; todo_ok: boolean; servicios: Servicio[] }> {
  const e = env();
  const servicios = await Promise.all([
    medir('railway', 'Railway (API BackIO)', async () => `Node ${process.version} · ${Math.round(process.uptime() / 60)} min activo`),
    medir('vercel', 'Vercel (frontend)', async (signal) => { const url = frontendOrigins()[0]; if (!url) throw new Error('no_configurado'); await esperar(await fetch(`${url}/login`, { signal, redirect: 'manual' })); return url; }),
    medir('supabase_db', 'Supabase DB', async () => { const { error } = await serviceClient().from('tenants').select('id').eq('id', tenantId).limit(1); if (error) throw new Error(error.message); }),
    medir('supabase_auth', 'Supabase Auth', async (signal) => { await esperar(await fetch(`${e.SUPABASE_URL}/auth/v1/health`, { signal, headers: { apikey: e.SUPABASE_ANON_KEY } })); }),
    medir('basecamp', 'Basecamp', async () => { const st = await getStatus(tenantId); if (!st.conectado) throw new Error('no_configurado'); const bc = await BasecampClient.forTenant(tenantId); await bc.request<unknown>('GET', '/my/profile.json'); return st.cuenta ?? null; }),
    medir('resend', 'Resend (correo)', async (signal) => { const k = process.env.RESEND_API_KEY; if (!k) throw new Error('no_configurado'); await esperar(await fetch('https://api.resend.com/domains', { signal, headers: { Authorization: `Bearer ${k}` } }), (s) => s === 200); return process.env.EMAIL_FROM ?? null; }),
    medir('anthropic', 'Anthropic (IA)', async (signal) => { const k = e.ANTHROPIC_API_KEY; if (!k) throw new Error('no_configurado'); await esperar(await fetch('https://api.anthropic.com/v1/models?limit=1', { signal, headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01' } }), (s) => s === 200); return 'claude-sonnet-5'; }),
    medir('prometio', 'PrometIO', async (signal) => { const url = process.env.PROMETIO_URL ?? 'https://prometio-backend-production.up.railway.app'; await esperar(await fetch(`${url}/health`, { signal }), (s) => s === 200); return e.PROMETIO_WEBHOOK_SECRET ? 'webhook configurado' : 'sin secreto de webhook'; }),
  ]);
  return { verificado_at: new Date().toISOString(), todo_ok: servicios.every((s) => s.estado === 'ok' || s.estado === 'no_configurado'), servicios };
}
