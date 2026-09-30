-- Auditoría de seguridad run-1 (28/09/2026): tres hallazgos del acceso directo a la base (PostgREST).
-- ZONA DE REVISIÓN HUMANA (CLAUDE.md): cambia funciones que usan todas las políticas RLS, políticas y triggers.
-- Todo es idempotente. El backend escribe con service role (auth.uid() es null) y no se ve afectado por los triggers.
--
--  1. rls:auth-helpers:ignore-usuarios-activo
--     Las funciones auth_* no miraban usuarios.activo: un usuario desactivado seguía leyendo (y, si era de gestión,
--     escribiendo) todo el tenant con un JWT vigente, y un admin desactivado podía reactivarse a sí mismo.
--  2. rls:cumplimiento-bitacora:insert-update-tenant-only
--     Reprocesos, reprogramaciones y bitácora aceptaban inserts de cualquier usuario del tenant sobre cualquier tarea,
--     con usuario_id a elección, y el update permitía mover una fila a otra tarea. Alimentan los KPIs por persona.
--  3. trigger:requerimientos_limitar_colaborador:denylist-misses-kpi-and-rule3-columns
--     El trigger del colaborador era una lista negra: dejaba escribir completado_at con fecha pasada (inflaba a_tiempo),
--     resetear veces_reprogramado, cambiar brief_url, plantilla, creador… y completar tareas ligadas a Basecamp (regla 3).

-- ============================================================================
-- 1. Identidad RLS solo para usuarios activos
-- create or replace conserva los grants existentes (revoke public + execute a authenticated).
-- ============================================================================
create or replace function auth_tenant_id() returns uuid
language sql stable security definer set search_path = public as $$
  select tenant_id from usuarios where id = auth.uid() and activo
$$;

create or replace function auth_rol() returns rol_t
language sql stable security definer set search_path = public as $$
  select rol from usuarios where id = auth.uid() and activo
$$;

create or replace function auth_es_gestion() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select rol in ('admin','gerencia','operaciones','ejecutiva','lider')
       from usuarios where id = auth.uid() and activo),
    false)
$$;

create or replace function auth_es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select rol = 'admin' from usuarios where id = auth.uid() and activo), false)
$$;

-- ============================================================================
-- 2. Reprocesos, reprogramaciones y bitácora: fuera de gestión, solo sobre tareas propias y a nombre propio
-- ============================================================================
drop policy if exists reprocesos_insert on reprocesos;
create policy reprocesos_insert on reprocesos for insert to authenticated
  with check (tenant_id = auth_tenant_id() and (auth_es_gestion() or exists (
    select 1 from requerimientos r
     where r.id = reprocesos.requerimiento_id and r.tenant_id = reprocesos.tenant_id and auth.uid() = any(r.owner_agencia))));

drop policy if exists reprocesos_update on reprocesos;
create policy reprocesos_update on reprocesos for update to authenticated
  using (tenant_id = auth_tenant_id() and (auth_es_gestion() or exists (
    select 1 from requerimientos r where r.id = reprocesos.requerimiento_id and auth.uid() = any(r.owner_agencia))))
  with check (tenant_id = auth_tenant_id() and (auth_es_gestion() or exists (
    select 1 from requerimientos r
     where r.id = reprocesos.requerimiento_id and r.tenant_id = reprocesos.tenant_id and auth.uid() = any(r.owner_agencia))));

drop policy if exists reprogramaciones_insert on reprogramaciones;
create policy reprogramaciones_insert on reprogramaciones for insert to authenticated
  with check (tenant_id = auth_tenant_id() and (auth_es_gestion() or exists (
    select 1 from requerimientos r
     where r.id = reprogramaciones.requerimiento_id and r.tenant_id = reprogramaciones.tenant_id and auth.uid() = any(r.owner_agencia))));

drop policy if exists reprogramaciones_update on reprogramaciones;
create policy reprogramaciones_update on reprogramaciones for update to authenticated
  using (tenant_id = auth_tenant_id() and (auth_es_gestion() or exists (
    select 1 from requerimientos r where r.id = reprogramaciones.requerimiento_id and auth.uid() = any(r.owner_agencia))))
  with check (tenant_id = auth_tenant_id() and (auth_es_gestion() or exists (
    select 1 from requerimientos r
     where r.id = reprogramaciones.requerimiento_id and r.tenant_id = reprogramaciones.tenant_id and auth.uid() = any(r.owner_agencia))));

drop policy if exists bitacora_insert on bitacora;
create policy bitacora_insert on bitacora for insert to authenticated
  with check (tenant_id = auth_tenant_id() and (auth_es_gestion() or exists (
    select 1 from requerimientos r
     where r.id = bitacora.requerimiento_id and r.tenant_id = bitacora.tenant_id and auth.uid() = any(r.owner_agencia))));

drop policy if exists bitacora_update on bitacora;
create policy bitacora_update on bitacora for update to authenticated
  using (tenant_id = auth_tenant_id() and (auth_es_gestion() or usuario_id = auth.uid()))
  with check (tenant_id = auth_tenant_id() and (auth_es_gestion() or usuario_id = auth.uid()));

-- Autoría y tarea fijas para quien no es de gestión; una nota de colaborador nunca queda visible al cliente.
-- (Las filas automáticas de reprogramación las inserta un trigger security definer con usuario_id = updated_by,
--  que para un colaborador es él mismo: no cambia nada.)
create or replace function historial_proteger_no_gestion() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is null or auth_es_gestion() then return new; end if;
  if tg_op = 'INSERT' then
    new.usuario_id := auth.uid();
    if tg_table_name = 'bitacora' then new.visible_cliente := false; end if;
    return new;
  end if;
  if new.requerimiento_id is distinct from old.requerimiento_id
     or new.usuario_id is distinct from old.usuario_id
     or new.tenant_id is distinct from old.tenant_id then
    raise exception 'No puedes cambiar la tarea ni el autor de este registro' using errcode = 'insufficient_privilege';
  end if;
  if tg_table_name = 'bitacora' and new.visible_cliente and not old.visible_cliente then
    raise exception 'Solo gestión decide qué notas ve el cliente' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists trg_reprocesos_proteger on reprocesos;
create trigger trg_reprocesos_proteger before insert or update on reprocesos
  for each row execute function historial_proteger_no_gestion();
drop trigger if exists trg_reprogramaciones_proteger on reprogramaciones;
create trigger trg_reprogramaciones_proteger before insert or update on reprogramaciones
  for each row execute function historial_proteger_no_gestion();
drop trigger if exists trg_bitacora_proteger on bitacora;
create trigger trg_bitacora_proteger before insert or update on bitacora
  for each row execute function historial_proteger_no_gestion();

-- ============================================================================
-- 3. Colaborador en requerimientos: lista blanca (espejo de CAMPOS_COLABORADOR del backend) + regla 3
-- Corre después de trg_requerimientos_before_update (orden alfabético), así que ve completado_at,
-- veces_reprogramado y ultima_actualizacion ya calculados: esos solo se aceptan con valores coherentes.
-- ============================================================================
create or replace function requerimientos_limitar_colaborador() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  -- Lo que un colaborador cambia (routes/v1/requerimientos.ts CAMPOS_COLABORADOR) + columnas que calculan
  -- los triggers o el backend en el mismo update (updated_at lo pisa trg_requerimientos_updated_at después).
  permitidas text[] := array[
    'estado_operativo', 'fecha_entrega', 'entregable_urls', 'daily_fecha', 'piezas',
    'updated_at', 'updated_by', 'ultima_actualizacion', 'completado_at', 'veces_reprogramado', 'veces_reproceso'];
begin
  if auth.uid() is null or auth_es_gestion() then return new; end if;
  if not (auth.uid() = any(old.owner_agencia)) then
    raise exception 'Solo puedes actualizar las tareas asignadas a ti' using errcode = 'insufficient_privilege';
  end if;
  if (to_jsonb(new) - permitidas) is distinct from (to_jsonb(old) - permitidas) then
    raise exception 'Como colaborador solo puedes cambiar estado, fecha de entrega, entregables, piezas y la selección del daily'
      using errcode = 'insufficient_privilege';
  end if;
  if new.updated_by is distinct from old.updated_by and new.updated_by is distinct from auth.uid() then
    raise exception 'updated_by debe ser tu usuario' using errcode = 'insufficient_privilege';
  end if;
  if new.veces_reprogramado not between old.veces_reprogramado and old.veces_reprogramado + 1
     or new.veces_reproceso not between old.veces_reproceso and old.veces_reproceso + 1 then
    raise exception 'Los contadores de reprogramación y reproceso no se editan a mano' using errcode = 'insufficient_privilege';
  end if;
  if new.completado_at is distinct from old.completado_at and new.completado_at < now() - interval '5 minutes' then
    raise exception 'No se puede fijar una fecha de completado pasada' using errcode = 'insufficient_privilege';
  end if;
  if new.ultima_actualizacion is distinct from old.ultima_actualizacion and new.ultima_actualizacion < now() - interval '5 minutes' then
    raise exception 'No se puede fijar una última actualización pasada' using errcode = 'insufficient_privilege';
  end if;
  -- Regla 3: Basecamp manda sobre completed. Antes solo lo aplicaba la ruta del backend.
  if new.estado_operativo = 'completado' and old.estado_operativo is distinct from 'completado' and old.basecamp_todo_id is not null then
    raise exception 'Este requerimiento se completa desde Basecamp' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
-- El trigger trg_requerimientos_limitar_colaborador (migración 21) ya apunta a esta función.

-- ============================================================================
-- Verificación después de aplicar (solo lectura):
--   select proname, prosrc like '%and activo%' as filtra_activo from pg_proc
--    where proname in ('auth_tenant_id','auth_rol','auth_es_gestion','auth_es_admin');          -- las 4 en true
--   select tgname from pg_trigger where tgname in ('trg_reprocesos_proteger','trg_reprogramaciones_proteger','trg_bitacora_proteger');
--   select polname, pg_get_expr(polwithcheck, polrelid) from pg_policy where polname in ('reprocesos_insert','bitacora_insert','reprogramaciones_update');
--   select count(*) as inactivos_con_sesion_posible from usuarios where not activo;  -- desde ahora sin acceso por RLS
-- ============================================================================
