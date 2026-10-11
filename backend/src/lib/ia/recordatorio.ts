/**
 * Recordatorio al cliente: borrador de correo para un requerimiento en espera del cliente.
 * Usa SOLO lo que el cliente puede ver (etiqueta_cliente o título si es visible). Nunca titulo_interno
 * de un requerimiento oculto, nunca texto de Basecamp. La ejecutiva copia, ajusta y envía desde su correo.
 */
import type { DbCtx } from '../db/client';
import { getRequerimiento } from '../db/requerimientos';
import { getCliente } from '../db/clientes';
import { getProyecto } from '../db/proyectos';
import { generarTexto } from './index';

const SYSTEM_RECORDATORIO = `Redacta un correo corto (asunto + cuerpo, máximo 120 palabras) de la ejecutiva de cuentas al cliente
recordando con amabilidad que un pendiente depende de ellos. Formato:
Asunto: ...
(línea en blanco)
cuerpo
- Tono amable y concreto, sin reclamo.
- Menciona el pendiente, los días de espera y la fecha comprometida solo si están en el JSON. No supongas qué se
  desbloquea ni qué pasa después.
- Cierra con una pregunta concreta (por ejemplo, "¿Nos lo puedes enviar antes del jueves?"), sin fórmulas de cortesía
  como "quedo atenta a cualquier inquietud". Firma con el nombre de la ejecutiva. Sin emojis.`;

export async function redactarRecordatorio(
  ctx: DbCtx,
  requerimientoId: string,
  ejecutiva: string,
): Promise<{ texto: string; titulo_usado: string }> {
  const r = await getRequerimiento(ctx, requerimientoId);
  if (!r) throw new Error('Requerimiento no encontrado');
  if (r.estado_aprobacion !== 'pendiente_cliente' && r.estado_operativo !== 'bloqueado')
    throw new Error('El requerimiento no está esperando al cliente');
  const [cliente, proyecto] = await Promise.all([
    getCliente(ctx, r.cliente_id),
    r.proyecto_id ? getProyecto(ctx, r.proyecto_id) : Promise.resolve(null),
  ]);
  const titulo = r.etiqueta_cliente ?? (r.visible_cliente ? r.titulo_interno : 'un pendiente de su lado');
  const dias = Math.max(0, Math.round((Date.now() - new Date(r.ultima_actualizacion).getTime()) / 86_400_000));
  const payload = {
    cliente: cliente?.nombre ?? 'cliente',
    proyecto: proyecto?.nombre ?? null,
    pendiente: titulo,
    tipo_de_espera: r.estado_aprobacion === 'pendiente_cliente' ? 'aprobación o feedback del cliente' : 'insumo o respuesta del cliente',
    dias_esperando: dias,
    fecha_entrega_comprometida: r.fecha_entrega,
    ejecutiva,
  };
  const g = await generarTexto(ctx, {
    tipo: 'recordatorio',
    entidad: { tipo: 'requerimiento', id: r.id },
    payload,
    system: SYSTEM_RECORDATORIO,
    maxTokens: 400,
    cacheMs: 60 * 60_000,
  });
  return { texto: g.texto, titulo_usado: titulo };
}
