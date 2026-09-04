/**
 * Brief → plan: la ejecutiva pega el correo o mensaje del cliente y la IA lo convierte
 * en el brief estructurado del Builder (paso 2) + plantilla y piezas sugeridas.
 * El texto pegado es del cliente hacia la agencia (no es texto de Basecamp). No se persiste.
 */
import type { BriefIA } from '@backio/shared';
import { CANALES } from '@backio/shared';
import type { DbCtx } from '../db/client';
import { listPlantillas } from '../db/plantillas';
import { listTiposPieza } from '../db/tipos_pieza';
import { fechaLocal } from '../rituals/daily';
import { generarJson } from './index';

const SYSTEM_BRIEF = `Eres la ejecutiva de cuentas senior de la agencia. Recibes el pedido de un cliente (correo, chat o notas)
y lo conviertes en el brief estructurado del proyecto. Devuelve JSON exacto:
{
  "nombre_proyecto": string|null,
  "objetivo_negocio": string,
  "publico_objetivo": string,
  "canales": string[],
  "mandatorios_marca": string|null,
  "fecha_entrega": "YYYY-MM-DD"|null,
  "presupuesto_aprobado": number|null,
  "plantilla_sugerida_id": string|null,
  "piezas_por_tipo": { "<tipo_pieza_id>": number },
  "dudas": string[]
}
- "canales" solo con valores de la lista "canales_validos".
- "plantilla_sugerida_id" debe ser un id de "plantillas" (elige por familia y pilar; si el pedido es un fee mensual de redes, la de cronograma/contenido). null si ninguna encaja.
- "piezas_por_tipo": cantidades que el cliente pide por tipo (post estático, carrusel, reel) usando los ids de "tipos_pieza". Omite los que no se mencionan.
- "fecha_entrega": solo si el texto da una fecha o plazo claro; calcula a partir de "hoy". Nunca en el pasado.
- "dudas": lo que falta preguntar al cliente antes de arrancar (máximo 5, concretas).
- Escribe objetivo y público en 1 a 3 frases cada uno, con las palabras del cliente cuando sirvan.`;

export async function briefDesdeTexto(ctx: DbCtx, texto: string, clienteId?: string | null): Promise<BriefIA> {
  const [plantillas, tipos] = await Promise.all([listPlantillas(ctx, { clienteId: clienteId ?? null }), listTiposPieza(ctx)]);
  const payload = {
    hoy: fechaLocal(),
    texto_del_cliente: texto.slice(0, 12_000),
    canales_validos: CANALES,
    plantillas: plantillas.map((p) => ({ id: p.id, nombre: p.nombre, pilar: p.pilar, familia: p.familia, recurrente: p.recurrente, descripcion: p.descripcion })),
    tipos_pieza: tipos.map((t) => ({ id: t.id, nombre: t.nombre })),
  };
  const out = await generarJson<BriefIA>(ctx, { tipo: 'brief', payload, system: SYSTEM_BRIEF, maxTokens: 1200, cacheMs: 0 });
  const pl = plantillas.find((p) => p.id === out.plantilla_sugerida_id) ?? null;
  const tiposIds = new Set(tipos.map((t) => t.id));
  return {
    nombre_proyecto: out.nombre_proyecto ?? null,
    objetivo_negocio: out.objetivo_negocio ?? '',
    publico_objetivo: out.publico_objetivo ?? '',
    canales: (out.canales ?? []).filter((c) => CANALES.includes(c)),
    mandatorios_marca: out.mandatorios_marca ?? null,
    fecha_entrega: out.fecha_entrega && out.fecha_entrega >= fechaLocal() ? out.fecha_entrega : null,
    presupuesto_aprobado: typeof out.presupuesto_aprobado === 'number' ? out.presupuesto_aprobado : null,
    plantilla_sugerida_id: pl?.id ?? null,
    plantilla_sugerida_nombre: pl?.nombre ?? null,
    piezas_por_tipo: Object.fromEntries(Object.entries(out.piezas_por_tipo ?? {}).filter(([k, v]) => tiposIds.has(k) && Number(v) > 0).map(([k, v]) => [k, Number(v)])),
    dudas: (out.dudas ?? []).slice(0, 5),
  };
}
