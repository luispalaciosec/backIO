/**
 * Webhook de Basecamp. Basecamp NO firma los payloads: la autenticidad se garantiza con un
 * token secreto en la URL registrada (/api/webhooks/basecamp/<token>) que solo Basecamp conoce.
 */
import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';
import { serviceClient } from '../../lib/db';
import { extractSafePayload, extractSafeTodo, applyBasecampUpdate, type BasecampSyncPayload } from '../../lib/basecamp/sync';
import { findByBasecampTodo } from '../../lib/db/requerimientos';
import type { Requerimiento } from '@backio/shared';
import { audit } from '../../lib/db/audit';
import { BasecampClient } from '../../lib/basecamp/client';
import { importarBasecampCliente } from '../../lib/basecamp/importar';

export const basecampWebhook = new Hono();

/**
 * To-do nuevo (o restaurado) que BackIO aún no conoce: se sincroniza la estructura de ESE cliente en segundos,
 * sin esperar la corrida periódica. Debounce de 20 s por cliente para agrupar varias creaciones seguidas.
 */
const importacionesPendientes = new Map<string, NodeJS.Timeout>();
async function programarImportacion(bucketId: number): Promise<void> {
  const db = serviceClient();
  const { data } = await db
    .from('clientes')
    .select('id, tenant_id, nombre')
    .eq('basecamp_project_id', bucketId)
    .eq('activo', true)
    .is('deleted_at', null)
    .maybeSingle();
  const cl = data as { id: string; tenant_id: string; nombre: string } | null;
  if (!cl) return;
  const previo = importacionesPendientes.get(cl.id);
  if (previo) clearTimeout(previo);
  importacionesPendientes.set(
    cl.id,
    setTimeout(async () => {
      importacionesPendientes.delete(cl.id);
      try {
        const r = await importarBasecampCliente(
          { db: serviceClient(), tenantId: cl.tenant_id, usuarioId: null, origen: 'webhook:basecamp' },
          cl.id,
        );
        if (r.requerimientos_creados || r.proyectos_creados)
          console.log(
            '[webhook basecamp] estructura',
            cl.nombre,
            JSON.stringify({ tareas: r.requerimientos_creados, proyectos: r.proyectos_creados }),
          );
      } catch (err) {
        console.error('[webhook basecamp] importación', cl.nombre, err instanceof Error ? err.message : err);
      }
    }, 20_000),
  );
}

/**
 * Basecamp no firma los webhooks y el secreto de la URL es el mismo para todos los proyectos: el payload no prueba
 * nada sobre el estado. Para un to-do que BackIO gestiona, el estado se lee SIEMPRE del to-do vivo, en el proyecto
 * del cliente guardado en BackIO (no en el bucket que diga el payload). Auditoría run-1: con el secreto se podía
 * marcar cualquier tarea como completada o cancelada.
 * Devuelve null si el evento no corresponde al proyecto del cliente o el to-do no se pudo leer.
 */
async function estadoVivo(req: Requerimiento, safe: BasecampSyncPayload): Promise<BasecampSyncPayload | null> {
  const { data } = await serviceClient()
    .from('clientes')
    .select('basecamp_project_id')
    .eq('id', req.cliente_id)
    .eq('tenant_id', req.tenant_id)
    .maybeSingle();
  const proyecto = (data as { basecamp_project_id: number | null } | null)?.basecamp_project_id ?? null;
  if (!proyecto || (safe.bucket_id !== null && safe.bucket_id !== proyecto)) return null;
  const bc = await BasecampClient.forTenant(req.tenant_id);
  let raw: unknown;
  try {
    raw = await bc.getTodoRaw(proyecto, safe.todo_id);
  } catch (err) {
    // 404: el to-do ya no está accesible (papelera o eliminado). Solo cuenta si el evento dice justamente eso.
    if (err instanceof Error && err.message.startsWith('Basecamp 404 ') && safe.eliminado === true)
      return { ...safe, bucket_id: proyecto, completed: null };
    throw err;
  }
  const vivo = extractSafeTodo(raw);
  if (!vivo) return null;
  const status = (raw as { status?: unknown }).status;
  const eliminado =
    status === 'trashed' || status === 'archived' ? true : safe.eliminado === false && status === 'active' ? false : undefined;
  return { ...vivo, bucket_id: proyecto, completed: vivo.completed ?? false, ...(eliminado !== undefined ? { eliminado } : {}) };
}

function tokenValido(t: string | undefined): boolean {
  const secret = env().BASECAMP_WEBHOOK_SECRET;
  if (!secret) return env().NODE_ENV !== 'production';
  if (!t || t.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(t), Buffer.from(secret));
}

async function handle(raw: string) {
  let evento: unknown;
  try {
    evento = JSON.parse(raw);
  } catch {
    return { status: 400 as const, body: 'bad json' };
  }
  // EXTRACCIÓN ESTRICTA (docs/02 · Defensa 1). El JSON crudo no se guarda ni se loguea.
  let safe: BasecampSyncPayload | null = extractSafePayload(evento);
  if (!safe) return { status: 200 as const, body: 'ok' };
  const kind = (evento as { kind?: string }).kind ?? '';
  const ctx = { db: serviceClient(), tenantId: '', usuarioId: null, origen: 'webhook:basecamp' as const };

  // Creado a mano en Basecamp (o devuelto de la papelera) y todavía sin requerimiento: entra en segundos.
  if (
    ['todo_created', 'todo_untrashed', 'todo_unarchived', 'todo_changed'].includes(kind) &&
    safe.bucket_id &&
    !(await findByBasecampTodo(ctx, safe.todo_id))
  ) {
    void programarImportacion(safe.bucket_id);
    if (kind === 'todo_created') return { status: 200 as const, body: 'ok' };
  }

  // To-do gestionado: el estado sale del to-do vivo, nunca del payload. Solo se extraen campos seguros.
  const req = await findByBasecampTodo(ctx, safe.todo_id);
  if (req) {
    try {
      const vivo = await estadoVivo(req, safe);
      if (!vivo) return { status: 200 as const, body: JSON.stringify({ aplicado: false, motivo: 'evento no verificado contra Basecamp' }) };
      safe = vivo;
    } catch (err) {
      console.error('[webhook basecamp] no se pudo consultar el to-do vivo', err instanceof Error ? err.message : err);
      return { status: 503 as const, body: 'reintentar' }; // Basecamp reintenta la entrega
    }
  }

  const resultado = await applyBasecampUpdate(ctx, safe);
  if (resultado.requerimiento_id) {
    const { data } = await ctx.db.from('requerimientos').select('tenant_id').eq('id', resultado.requerimiento_id).single();
    const tenantId = (data as { tenant_id: string } | null)?.tenant_id;
    if (tenantId)
      await audit(
        { ...ctx, tenantId },
        {
          accion: 'webhook_basecamp',
          entidad: 'requerimiento',
          entidad_id: resultado.requerimiento_id,
          detalle: { kind, todo_id: safe.todo_id, ...resultado },
        },
      );
  }
  return { status: 200 as const, body: JSON.stringify(resultado) };
}

basecampWebhook.post('/:token', async (c) => {
  if (!tokenValido(c.req.param('token'))) return c.text('unauthorized', 401);
  const r = await handle(await c.req.text());
  return c.text(r.body, r.status);
});

// Compatibilidad: sin token solo en desarrollo.
basecampWebhook.post('/', async (c) => {
  if (!tokenValido(undefined)) return c.text('unauthorized', 401);
  const r = await handle(await c.req.text());
  return c.text(r.body, r.status);
});
