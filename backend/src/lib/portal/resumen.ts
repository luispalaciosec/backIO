/**
 * Resumen ejecutivo con IA (docs/06). El modelo recibe ÚNICAMENTE el payload
 * sanitizado. No puede alucinar contenido interno porque no lo tiene.
 * Caché de 6 horas por proyecto (evita costo y textos distintos al recargar).
 */
import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { MODELO_IA, SIN_RAZONAMIENTO } from '../ia';
import type { ClientSafeProject } from '@backio/shared';
import { assertClientSafe } from '@backio/shared';
import { env } from '../../config/env';
import { getResumenPortal, guardarResumenPortal } from '../db/portal';

const CACHE_MS = 6 * 3600 * 1000;

export const SYSTEM_PROMPT = `Eres el asistente de comunicación de Geeks Ecuador, agencia creativa.
Escribes para un cliente corporativo en español de Ecuador neutro.

Redacta un resumen ejecutivo de máximo 3 párrafos cortos sobre el estado
del proyecto, usando ÚNICAMENTE los datos del JSON.

Reglas:
- Tono sobrio. Sin superlativos ni marketing.
- Si algo espera al cliente ("esperando_cliente"), di qué es y desde cuándo, en una frase, sin tono de reclamo.
- No inventes fechas, nombres, personas ni actividades que no estén en el JSON.
- No uses jerga de agencia ni las fórmulas "no es X, es Y", "clave", "potenciar" o enumeraciones de tres adjetivos.
- Nunca uses voseo argentino.
- Si no hay datos suficientes para un párrafo, escribe menos.
- Texto plano: sin título, sin negritas ni otro formato. El portal lo muestra tal cual.`;

export interface PayloadResumen {
  proyecto: string;
  cliente: string;
  avance_ponderado: number;
  completados: string[];
  en_curso: string[];
  por_iniciar: string[];
  fecha_entrega: string;
  esperando_cliente: { titulo: string; dias: number }[];
}

export function payloadDesdeSafe(safe: ClientSafeProject, cliente: string): PayloadResumen {
  return {
    proyecto: safe.nombre,
    cliente,
    avance_ponderado: safe.avance,
    completados: safe.hitos.filter((h) => h.estado === 'completado').map((h) => h.titulo),
    en_curso: safe.hitos.filter((h) => h.estado === 'en_proceso').map((h) => h.titulo),
    por_iniciar: safe.hitos.filter((h) => h.estado === 'pendiente').map((h) => h.titulo),
    fecha_entrega: safe.fecha_entrega,
    esperando_cliente: safe.bloqueado_por_cliente,
  };
}

export async function generarResumen(proyectoId: string, tenantId: string, safe: ClientSafeProject, cliente: string): Promise<string> {
  assertClientSafe(safe);
  const payload = payloadDesdeSafe(safe, cliente);
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');

  const cache = await getResumenPortal(proyectoId);
  const c = cache as { payload_hash: string; resumen: string; generado_at: string } | null;
  if (c && c.payload_hash === hash && Date.now() - new Date(c.generado_at).getTime() < CACHE_MS) return c.resumen;

  const key = env().ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY no configurada');
  const anthropic = new Anthropic({ apiKey: key });
  const res = await anthropic.messages.create({
    model: MODELO_IA,
    max_tokens: 600,
    thinking: SIN_RAZONAMIENTO,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: JSON.stringify(payload, null, 2) }],
  });
  const texto = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  // Sin texto (rechazo del modelo o límite de tokens): no se guarda un resumen vacío en la caché del portal.
  if (!texto) throw new Error(`Resumen vacío (${res.stop_reason ?? 'sin motivo'})`);

  await guardarResumenPortal({
    proyecto_id: proyectoId,
    tenant_id: tenantId,
    payload_hash: hash,
    resumen: texto,
    generado_at: new Date().toISOString(),
  });
  return texto;
}
