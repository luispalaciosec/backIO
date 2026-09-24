-- Revisión de seguridad 23/09/2026 · correcciones a nivel de base de datos.
-- ZONA DE REVISIÓN HUMANA (CLAUDE.md): políticas RLS. Leer completo antes de aplicar.
-- Cada bloque es independiente y explica el hallazgo que cierra.

-- ============================================================================
-- 1. CRÍTICO · Tokens OAuth de Basecamp fuera de tenants.config
-- tenants.config era legible por cualquier usuario autenticado del tenant (tenants_select), y ahí vivían
-- access_token y refresh_token de Basecamp. Con ellos se leen comentarios y adjuntos de todos los
-- proyectos: la regla 1 quedaba rota por fuera de BackIO. Nueva tabla sin políticas: solo service role.
-- El backend ya lee/escribe aquí (lib/basecamp/credenciales.ts) y cae al esquema viejo si la tabla no existe.
-- ============================================================================
create table if not exists integracion_credenciales (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  proveedor   text not null,
  datos       jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, proveedor)
);
alter table integracion_credenciales enable row level security;
-- Sin políticas a propósito: ni authenticated ni anon pueden leerla. Solo service role (bypass RLS).

insert into integracion_credenciales (tenant_id, proveedor, datos)
select id, 'basecamp', config->'basecamp' from tenants where config ? 'basecamp'
on conflict (tenant_id, proveedor) do update set datos = excluded.datos, updated_at = now();

update tenants set config = config - 'basecamp' where config ? 'basecamp';

-- La URL del webhook (lleva el secreto) tampoco debe vivir en clientes.config.
update clientes set config = config - 'basecamp_webhook_url' where config ? 'basecamp_webhook_url';

-- ============================================================================
-- 2. CRÍTICO · Escalada de privilegios: un usuario podía cambiar su propio rol
-- usuarios_update_self permitía a cualquier usuario actualizar su fila entera por PostgREST
-- (rol → admin, activo, basecamp_user_id, capacidad_semanal). Trigger que protege esas columnas.
-- ============================================================================
create or replace function usuarios_proteger_columnas() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- service role (auth.uid() es null) y admin pueden todo.
  if auth.uid() is null or auth_es_admin() then return new; end if;
  if new.rol is distinct from old.rol
     or new.activo is distinct from old.activo
     or new.tenant_id is distinct from old.tenant_id
     or new.email is distinct from old.email
     or new.basecamp_user_id is distinct from old.basecamp_user_id
     or new.capacidad_semanal is distinct from old.capacidad_semanal then
    raise exception 'Solo un administrador puede cambiar rol, estado, correo, capacidad o vínculo con Basecamp'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
drop trigger if exists trg_usuarios_proteger_columnas on usuarios;
create trigger trg_usuarios_proteger_columnas
  before update on usuarios for each row execute function usuarios_proteger_columnas();

-- ============================================================================
-- 3. ALTA · Colaborador: solo sus tareas y solo los campos permitidos, también por PostgREST
-- requerimientos_update dejaba a un colaborador cambiar cualquier columna (etiqueta_cliente, título,
-- responsables, prioridad, deleted_at…) de cualquier tarea saltándose el backend. Misma lista que
-- CAMPOS_COLABORADOR en routes/v1/requerimientos.ts.
-- ============================================================================
create or replace function requerimientos_limitar_colaborador() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or auth_es_gestion() then return new; end if;
  if not (auth.uid() = any(old.owner_agencia)) then
    raise exception 'Solo puedes actualizar las tareas asignadas a ti' using errcode = 'insufficient_privilege';
  end if;
  if new.titulo_interno        is distinct from old.titulo_interno
     or new.etiqueta_cliente   is distinct from old.etiqueta_cliente
     or new.visible_cliente    is distinct from old.visible_cliente
     or new.owner_agencia      is distinct from old.owner_agencia
     or new.owner_cliente      is distinct from old.owner_cliente
     or new.prioridad          is distinct from old.prioridad
     or new.peso               is distinct from old.peso
     or new.tipo_trabajo       is distinct from old.tipo_trabajo
     or new.estado_aprobacion  is distinct from old.estado_aprobacion
     or new.planificacion      is distinct from old.planificacion
     or new.proyecto_id        is distinct from old.proyecto_id
     or new.cliente_id         is distinct from old.cliente_id
     or new.tenant_id          is distinct from old.tenant_id
     or new.bloque_nombre      is distinct from old.bloque_nombre
     or new.fecha_pedido       is distinct from old.fecha_pedido
     or new.fecha_entrega_original is distinct from old.fecha_entrega_original
     or new.deleted_at         is distinct from old.deleted_at
     or new.basecamp_todo_id   is distinct from old.basecamp_todo_id
     or new.basecamp_todolist_id is distinct from old.basecamp_todolist_id
     or new.basecamp_url       is distinct from old.basecamp_url then
    raise exception 'Como colaborador solo puedes cambiar estado, fecha de entrega, entregables, piezas y la selección del daily'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
drop trigger if exists trg_requerimientos_limitar_colaborador on requerimientos;
create trigger trg_requerimientos_limitar_colaborador
  before update on requerimientos for each row execute function requerimientos_limitar_colaborador();

-- ============================================================================
-- 4. ALTA · Bitácora, reprogramaciones y reprocesos: editar/borrar solo gestión o dueño
-- Las políticas de update/delete eran "cualquier authenticated del tenant".
-- ============================================================================
drop policy if exists bitacora_update on bitacora;
drop policy if exists bitacora_delete on bitacora;
create policy bitacora_update on bitacora for update to authenticated
  using (tenant_id = auth_tenant_id() and (auth_es_gestion() or usuario_id = auth.uid()))
  with check (tenant_id = auth_tenant_id());
create policy bitacora_delete on bitacora for delete to authenticated
  using (tenant_id = auth_tenant_id() and (auth_es_gestion() or usuario_id = auth.uid()));

drop policy if exists reprogramaciones_update on reprogramaciones;
create policy reprogramaciones_update on reprogramaciones for update to authenticated
  using (tenant_id = auth_tenant_id() and (auth_es_gestion() or exists (
    select 1 from requerimientos r where r.id = reprogramaciones.requerimiento_id and auth.uid() = any(r.owner_agencia))))
  with check (tenant_id = auth_tenant_id());

drop policy if exists reprocesos_update on reprocesos;
create policy reprocesos_update on reprocesos for update to authenticated
  using (tenant_id = auth_tenant_id() and (auth_es_gestion() or exists (
    select 1 from requerimientos r where r.id = reprocesos.requerimiento_id and auth.uid() = any(r.owner_agencia))))
  with check (tenant_id = auth_tenant_id());

-- ============================================================================
-- 5. MEDIA · Regla 2 también en el INSERT
-- El trigger monotónico solo actuaba en update: un agente con write:requerimientos podía crear una tarea
-- visible al cliente sin plantilla. Sin plantilla, nace oculta salvo que la cree alguien de gestión.
-- ============================================================================
create or replace function requerimientos_visibilidad_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.visible_cliente = true and new.plantilla_tarea_id is null and not auth_es_gestion() then
    new.visible_cliente := false;
  end if;
  return new;
end $$;
drop trigger if exists trg_requerimientos_visibilidad_insert on requerimientos;
create trigger trg_requerimientos_visibilidad_insert
  before insert on requerimientos for each row execute function requerimientos_visibilidad_insert();

-- ============================================================================
-- 6. MEDIA · Un proyecto por lista de Basecamp (el solape de corridas duplicaba proyectos)
-- ============================================================================
create unique index if not exists proyectos_todolist_unico
  on proyectos (tenant_id, basecamp_todolist_id) where basecamp_todolist_id is not null and deleted_at is null;
