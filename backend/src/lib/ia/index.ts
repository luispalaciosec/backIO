/**
 * Capa de IA (Sprint 4). Un solo punto de entrada a Anthropic para toda la app.
 *
 * Reglas:
 *  - El modelo recibe ÚNICAMENTE datos estructurados de BackIO (títulos, estados, fechas,
 *    números). Nunca texto de Basecamp: ese texto nunca entra a BackIO, así que no puede llegar aquí.
 *  - Toda generación queda en `ia_generaciones` con el hash del payload (caché + auditoría).
 *  - La IA redacta; una persona publica. Los textos se firman "Redactado por BackIO, publicado por X".
 */
import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env';
import { serviceClient, throwIf, type DbCtx } from '../db/client';

export const MODELO_IA = 'claude-sonnet-5';

export const ESTILO_GEEKS = `Escribes para Geeks Ecuador, agencia creativa en Quito. Español de Ecuador, neutro y directo.
Reglas fijas:
- Usa ÚNICAMENTE los datos del JSON. No inventes nombres, fechas, cifras ni tareas.
- Nada de superlativos ni marketing. Frases cortas. Sin voseo argentino.
- Si un dato no está, no lo menciones. No rellenes.
- No uses emojis salvo que se indique.`;

export function iaDisponible(): boolean {
  return Boolean(env().ANTHROPIC_API_KEY);
}

export function firma(persona: string): string {
  return `Redactado por BackIO, publicado por ${persona}`;
}

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export interface GenerarOpts {
  tipo: string;
  entidad?: { tipo: string; id: string | null };
  payload: unknown;
  system: string;
  maxTokens?: number;
  /** ms de validez del caché por payload idéntico. 0 = sin caché. */
  cacheMs?: number;
}

export interface Generado { texto: string; desde_cache: boolean; modelo: string }

async function leerCache(ctx: DbCtx, tipo: string, hash: string, cacheMs: number): Promise<string | null> {
  if (!cacheMs) return null;
  const { data } = await serviceClient().from('ia_generaciones').select('texto, created_at').eq('tenant_id', ctx.tenantId).eq('tipo', tipo).eq('payload_hash', hash).order('created_at', { ascending: false }).limit(1).maybeSingle();
  const row = data as { texto: string; created_at: string } | null;
  if (!row) return null;
  return Date.now() - new Date(row.created_at).getTime() < cacheMs ? row.texto : null;
}

export async function generarTexto(ctx: DbCtx, o: GenerarOpts): Promise<Generado> {
  const key = env().ANTHROPIC_API_KEY;
  if (!key) throw new Error('La capa de IA no está configurada (falta ANTHROPIC_API_KEY en el backend)');
  const hash = hashPayload(o.payload);
  const cacheMs = o.cacheMs ?? 10 * 60_000;
  const cache = await leerCache(ctx, o.tipo, hash, cacheMs);
  if (cache) return { texto: cache, desde_cache: true, modelo: MODELO_IA };

  const anthropic = new Anthropic({ apiKey: key });
  const res = await anthropic.messages.create({
    model: MODELO_IA,
    max_tokens: o.maxTokens ?? 900,
    system: `${ESTILO_GEEKS}\n\n${o.system}`,
    messages: [{ role: 'user', content: JSON.stringify(o.payload, null, 2) }],
  });
  const texto = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (!texto) throw new Error('La IA no devolvió texto');
  const { error } = await serviceClient().from('ia_generaciones').insert({
    tenant_id: ctx.tenantId, tipo: o.tipo, entidad_tipo: o.entidad?.tipo ?? null, entidad_id: o.entidad?.id ?? null,
    payload_hash: hash, texto, modelo: MODELO_IA, tokens_entrada: res.usage?.input_tokens ?? null, tokens_salida: res.usage?.output_tokens ?? null,
    creado_por: ctx.usuarioId,
  });
  throwIf(error);
  return { texto, desde_cache: false, modelo: MODELO_IA };
}

/** Igual que generarTexto pero exige JSON y lo parsea (tolera fences ```json). */
export async function generarJson<T>(ctx: DbCtx, o: GenerarOpts): Promise<T> {
  const g = await generarTexto(ctx, { ...o, system: `${o.system}\n\nResponde ÚNICAMENTE con JSON válido, sin comentarios ni texto alrededor.` });
  const limpio = g.texto.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(limpio) as T; }
  catch { throw new Error('La IA devolvió un JSON inválido; vuelve a intentar'); }
}
