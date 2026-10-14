-- ============================================================================
-- Migración 32 · Dos defensas de la base más estrictas (escaneo del 13/10/2026, aprobado por Luis)
--
-- 1. Las columnas de salida (migración 30) quedan protegidas como el resto de la fila del usuario: una persona ya no
--    puede escribir su propia fecha_salida ni motivo_salida (solo un admin, o el backend con service role).
-- 2. Regla 2 en el INSERT: antes bastaba con mandar cualquier plantilla_tarea_id para que una tarea naciera visible al
--    cliente. Ahora tiene que ser una tarea de plantilla del mismo tenant marcada como visible por defecto; si no, nace
--    oculta (salvo que la cree alguien de gestión, igual que antes).
--
-- Zona de revisión humana (triggers de seguridad y visibilidad): no aplicar sin revisión de Luis.
-- ============================================================================

-- 1) Misma función que la migración 22, con las dos columnas nuevas.
create or replace function usuarios_proteger_columnas() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or auth_es_admin() then return new; end if;
  if new.rol is distinct from old.rol
     or new.activo is distinct from old.activo
     or new.tenant_id is distinct from old.tenant_id
     or new.email is distinct from old.email
     or new.basecamp_user_id is distinct from old.basecamp_user_id
     or new.capacidad_semanal is distinct from old.capacidad_semanal
     or new.area is distinct from old.area
     or new.fecha_salida is distinct from old.fecha_salida
     or new.motivo_salida is distinct from old.motivo_salida then
    raise exception 'Solo un administrador puede cambiar rol, estado, correo, capacidad, área, vínculo con Basecamp o datos de salida'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

-- 2) Misma función que la migración 21, validando la tarea de plantilla.
create or replace function requerimientos_visibilidad_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.visible_cliente = true and not auth_es_gestion() and not exists (
    select 1 from plantilla_tareas pt
    where pt.id = new.plantilla_tarea_id
      and pt.tenant_id = new.tenant_id
      and pt.visible_cliente_default
  ) then
    new.visible_cliente := false;
  end if;
  return new;
end $$;
-- Los triggers (trg_usuarios_proteger_columnas y trg_requerimientos_visibilidad_insert) ya apuntan a estas funciones.

-- ============================================================================
-- Verificación después de aplicar (solo lectura):
--   select proname, prosrc like '%fecha_salida%' as protege_salida from pg_proc where proname = 'usuarios_proteger_columnas';   -- true
--   select proname, prosrc like '%visible_cliente_default%' as valida_plantilla from pg_proc
--    where proname = 'requerimientos_visibilidad_insert';                                                                       -- true
--   select tgname from pg_trigger where tgname in ('trg_requerimientos_visibilidad_insert');                                    -- 1 fila
-- ============================================================================
