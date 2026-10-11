import { serviceClient, throwIf } from './client';
import { paginar } from './paginar';

/** Lo que las reparaciones necesitan de cada requerimiento vivo (sin borrar). */
export interface ReqMantenimiento {
  id: string;
  cliente_id: string;
  titulo_interno: string;
  basecamp_todo_id: number | null;
  estado_operativo: string;
  created_at: string;
  fecha_entrega: string | null;
  owner_agencia: string[];
}

export interface ClienteMantenimiento {
  id: string;
  nombre: string;
  activo: boolean;
  basecamp_project_id: number | null;
}

export interface HuerfanoAdoptado {
  id: string;
  basecamp_todo_id: number;
  basecamp_todolist_id: number | null;
  app_url: string | null;
  requerimiento_id: string | null;
}

// Las reparaciones leen todo el tenant: van con service role, acotadas por tenant_id, y solo las llama un admin.

export async function requerimientosVivos(tenantId: string): Promise<ReqMantenimiento[]> {
  const db = serviceClient();
  return paginar<ReqMantenimiento>((from, to) =>
    db
      .from('requerimientos')
      .select('id, cliente_id, titulo_interno, basecamp_todo_id, estado_operativo, created_at, fecha_entrega, owner_agencia')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('created_at')
      .order('id')
      .range(from, to),
  );
}

export async function clientesMantenimiento(tenantId: string): Promise<ClienteMantenimiento[]> {
  const { data, error } = await serviceClient()
    .from('clientes')
    .select('id, nombre, activo, basecamp_project_id')
    .eq('tenant_id', tenantId);
  throwIf(error);
  return data ?? [];
}

/** usuario_id → id de la persona en Basecamp, para los usuarios ya enlazados. */
export async function idsBasecampDeUsuarios(tenantId: string): Promise<Map<string, number>> {
  const { data, error } = await serviceClient()
    .from('usuarios')
    .select('id, basecamp_user_id')
    .eq('tenant_id', tenantId)
    .not('basecamp_user_id', 'is', null);
  throwIf(error);
  return new Map((data ?? []).flatMap((u) => (u.basecamp_user_id ? [[u.id, u.basecamp_user_id] as [string, number]] : [])));
}

export async function huerfanosAdoptados(tenantId: string): Promise<HuerfanoAdoptado[]> {
  const { data, error } = await serviceClient()
    .from('basecamp_huerfanos')
    .select('id, basecamp_todo_id, basecamp_todolist_id, app_url, requerimiento_id')
    .eq('tenant_id', tenantId)
    .eq('resolucion', 'adoptado');
  throwIf(error);
  return data ?? [];
}

/** Baja lógica (deleted_at): la fila sigue en la base. */
export async function darDeBajaRequerimientos(tenantId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await serviceClient()
    .from('requerimientos')
    .update({ deleted_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .in('id', ids)
    .is('deleted_at', null);
  throwIf(error);
}

/** Vuelve a enlazar un requerimiento con su to-do de Basecamp. */
export async function enlazarConTodo(
  tenantId: string,
  id: string,
  todo: { basecamp_todo_id: number; basecamp_todolist_id: number | null; basecamp_url: string | null },
): Promise<void> {
  const { error } = await serviceClient()
    .from('requerimientos')
    .update(todo)
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .is('basecamp_todo_id', null);
  throwIf(error);
}
