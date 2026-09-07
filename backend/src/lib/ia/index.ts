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
import { serviceClient, throwIf, DbError, type DbCtx } from '../db/client';

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

  const anthropic = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 60_000 });
  let res: Anthropic.Message;
  try {
    res = await anthropic.messages.create({
      model: MODELO_IA,
      max_tokens: o.maxTokens ?? 900,
      // La cuenta de producción activa el razonamiento extendido por defecto y sus bloques 'thinking'
      // agotaban max_tokens sin escribir texto. Lo desactivamos: aquí solo queremos redacción.
      thinking: { type: 'disabled' },
      system: `${ESTILO_GEEKS}\n\n${o.system}`,
      messages: [{ role: 'user', content: JSON.stringify(o.payload, null, 2) }],
    });
  } catch (err) {
    throw traducirErrorIA(err);
  }
  const texto = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (!texto) {
    console.error('[ia] respuesta sin texto', { tipo: o.tipo, stop_reason: res.stop_reason, bloques: res.content.map((b) => b.type), usage: res.usage });
    const motivo = res.stop_reason === 'max_tokens' ? 'se agotó el límite de tokens antes de escribir' : (res.stop_reason as string) === 'refusal' ? 'el modelo rechazó la solicitud' : `respuesta vacía (${res.stop_reason ?? 'sin motivo'})`;
    throw new DbError(`La IA no devolvió texto: ${motivo}. Vuelve a intentar; si persiste, avisa a Luis.`, 502);
  }
  const { error } = await serviceClient().from('ia_generaciones').insert({
    tenant_id: ctx.tenantId, tipo: o.tipo, entidad_tipo: o.entidad?.tipo ?? null, entidad_id: o.entidad?.id ?? null,
    payload_hash: hash, texto, modelo: MODELO_IA, tokens_entrada: res.usage?.input_tokens ?? null, tokens_salida: res.usage?.output_tokens ?? null,
    creado_por: ctx.usuarioId,
  });
  throwIf(error);
  return { texto, desde_cache: false, modelo: MODELO_IA };
}

/** Convierte errores de la API de Anthropic en mensajes que la persona pueda entender. */
export function traducirErrorIA(err: unknown): DbError {
  const e = err as { status?: number; message?: string; error?: { error?: { type?: string; message?: string } } };
  const msg = (e.error?.error?.message ?? e.message ?? '').toString();
  const status = e.status ?? 0;
  console.error('[ia] error de la API', { status, msg });
  if (status === 401 || /invalid x-api-key|authentication/i.test(msg)) return new DbError('La clave de IA no es válida o fue revocada (ANTHROPIC_API_KEY). Avisa a Luis.', 502);
  if (status === 402 || /credit balance|billing|insufficient/i.test(msg)) return new DbError('La cuenta de IA no tiene saldo. Hay que recargar créditos en Anthropic.', 502);
  if (status === 429) return new DbError('La IA está al límite de uso por ahora. Espera un minuto y vuelve a intentar.', 503);
  if (status === 529 || /overloaded/i.test(msg)) return new DbError('El servicio de IA está saturado en este momento. Vuelve a intentar en unos minutos.', 503);
  if (status === 404 || /model/i.test(msg) && /not found|does not exist/i.test(msg)) return new DbError(`El modelo de IA (${MODELO_IA}) no está disponible para esta clave. Avisa a Luis.`, 502);
  if (/timeout|timed out|ECONNRESET|fetch failed/i.test(msg)) return new DbError('La IA tardó demasiado en responder. Vuelve a intentar.', 504);
  return new DbError(`Error de la IA: ${msg || 'desconocido'}`, 502);
}

/** Igual que generarTexto pero exige JSON y lo parsea (tolera fences ```json). */
export async function generarJson<T>(ctx: DbCtx, o: GenerarOpts): Promise<T> {
  const g = await generarTexto(ctx, { ...o, system: `${o.system}\n\nResponde ÚNICAMENTE con JSON válido, sin comentarios ni texto alrededor.` });
  // Tolera fences y texto alrededor: se queda con el primer '{' y el último '}'.
  const sinFences = g.texto.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const a = sinFences.indexOf('{'); const b = sinFences.lastIndexOf('}');
  const limpio = a >= 0 && b > a ? sinFences.slice(a, b + 1) : sinFences;
  try { return JSON.parse(limpio) as T; }
  catch { console.error('[ia] JSON inválido', { tipo: o.tipo, muestra: limpio.slice(0, 300) }); throw new DbError('La IA devolvió una respuesta mal formada. Vuelve a intentar.', 502); }
}
