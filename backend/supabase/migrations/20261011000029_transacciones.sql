-- Auditoría externa del 10/10/2026 · Ola 6: operaciones de varios pasos en una sola transacción.
-- ZONA DE REVISIÓN HUMANA (CLAUDE.md): crea funciones; una de ellas SECURITY DEFINER. Idempotente.
-- Todo con esquema explícito (public.).
--
--  B7 · El import por CSV creaba proyectos dentro del bucle y luego las tareas: un fallo dejaba proyectos huérfanos
--       con portal token. El Builder tenía el mismo hueco (proyecto creado, tareas fallidas).
--       → crear_lote(): proyectos y requerimientos en una transacción. SECURITY INVOKER: corre con los permisos
--         de quien llama, así que las políticas RLS y los triggers de visibilidad aplican igual que antes.
--  B8 · «Quitar acceso» eran 6 pasos sueltos con errores tragados: podía responder ok y dejar API keys o tokens
--       OAuth vivos. → quitar_acceso(): credenciales, usuario, tareas y recurrencias en una transacción; si algo
--       falla no cambia nada. El bloqueo en Supabase Auth (API externa) lo hace el backend después.

-- ============================================================================
-- Inserta una fila desde jsonb usando solo las columnas presentes (las demás toman su default).
-- Solo para las dos tablas del lote. SECURITY INVOKER: RLS aplica.
-- ============================================================================
create or replace function public._insertar_fila(p_tabla text, p_fila jsonb)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_cols text;
  v_fila jsonb;
begin
  if p_tabla not in ('proyectos', 'requerimientos') then
    raise exception 'Tabla no permitida: %', p_tabla;
  end if;
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_cols
  from pg_attribute a
  where a.attrelid = ('public.' || p_tabla)::regclass
    and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
    and p_fila ? a.attname;
  if v_cols is null then
    raise exception 'Fila vacía para %', p_tabla;
  end if;
  execute format(
    'insert into public.%I as t (%s) select %s from jsonb_populate_record(null::public.%I, $1) returning to_jsonb(t.*)',
    p_tabla, v_cols, v_cols, p_tabla
  ) into v_fila using p_fila;
  return v_fila;
end $$;
revoke all on function public._insertar_fila(text, jsonb) from public, anon;
grant execute on function public._insertar_fila(text, jsonb) to authenticated, service_role;

-- ============================================================================
-- B7 · Lote de proyectos + requerimientos.
--   p_proyectos:      [{ "_clave": "...", ...columnas de proyectos }]
--   p_requerimientos: [{ "_proyecto_clave": "..." (opcional), ...columnas de requerimientos }]
-- Devuelve { proyectos: { clave: fila }, requerimientos: [fila, ...] }. Todo o nada.
-- ============================================================================
create or replace function public.crear_lote(p_proyectos jsonb, p_requerimientos jsonb)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_obj jsonb;
  v_fila jsonb;
  v_clave text;
  v_proyectos jsonb := '{}'::jsonb;
  v_reqs jsonb := '[]'::jsonb;
begin
  for v_obj in select * from jsonb_array_elements(coalesce(p_proyectos, '[]'::jsonb)) loop
    v_clave := v_obj ->> '_clave';
    if v_clave is null then raise exception 'Proyecto sin _clave'; end if;
    v_fila := public._insertar_fila('proyectos', v_obj - '_clave');
    v_proyectos := v_proyectos || jsonb_build_object(v_clave, v_fila);
  end loop;

  for v_obj in select * from jsonb_array_elements(coalesce(p_requerimientos, '[]'::jsonb)) loop
    if v_obj ? '_proyecto_clave' then
      v_clave := v_obj ->> '_proyecto_clave';
      if not v_proyectos ? v_clave then raise exception 'Proyecto % no está en el lote', v_clave; end if;
      v_obj := (v_obj - '_proyecto_clave') || jsonb_build_object('proyecto_id', v_proyectos -> v_clave ->> 'id');
    end if;
    v_reqs := v_reqs || jsonb_build_array(public._insertar_fila('requerimientos', v_obj));
  end loop;

  return jsonb_build_object('proyectos', v_proyectos, 'requerimientos', v_reqs);
end $$;
revoke all on function public.crear_lote(jsonb, jsonb) from public, anon;
grant execute on function public.crear_lote(jsonb, jsonb) to authenticated, service_role;

-- ============================================================================
-- B8 · Quitar acceso. SECURITY DEFINER (toca credenciales que RLS no deja ver): solo el backend (service_role),
-- que ya verificó que quien llama es admin. Filtra todo por p_tenant.
-- ============================================================================
create or replace function public.quitar_acceso(p_tenant uuid, p_usuario uuid, p_reasignar_a uuid, p_actor uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_keys int;
  v_tokens int;
  v_codigos int;
  v_tareas int;
  v_recurrencias int;
begin
  if not exists (select 1 from public.usuarios where id = p_usuario and tenant_id = p_tenant) then
    raise exception 'Usuario no encontrado en el tenant' using errcode = 'P0002';
  end if;
  if p_reasignar_a is not null and not exists (
    select 1 from public.usuarios where id = p_reasignar_a and tenant_id = p_tenant and activo and id <> p_usuario
  ) then
    raise exception 'La persona a quien se reasigna no está activa en el tenant' using errcode = '22023';
  end if;

  -- 1) Credenciales primero: API keys creadas por la persona, tokens y códigos OAuth.
  update public.api_keys set revocada_at = now()
    where tenant_id = p_tenant and creado_por = p_usuario and revocada_at is null;
  get diagnostics v_keys = row_count;
  delete from public.oauth_tokens where tenant_id = p_tenant and usuario_id = p_usuario;
  get diagnostics v_tokens = row_count;
  delete from public.oauth_codes where tenant_id = p_tenant and usuario_id = p_usuario;
  get diagnostics v_codigos = row_count;

  -- 2) Usuario inactivo (el middleware rechaza a inactivos aunque tengan sesión).
  update public.usuarios set activo = false where id = p_usuario and tenant_id = p_tenant;

  -- 3) Tareas abiertas: quitar a la persona y, si hay reemplazo, sumarlo (sin duplicar).
  update public.requerimientos r
    set owner_agencia = case
          when p_reasignar_a is null or p_reasignar_a = any(array_remove(r.owner_agencia, p_usuario))
            then array_remove(r.owner_agencia, p_usuario)
          else array_append(array_remove(r.owner_agencia, p_usuario), p_reasignar_a)
        end,
        updated_by = p_actor
    where r.tenant_id = p_tenant and r.deleted_at is null
      and r.estado_operativo not in ('completado', 'cancelado')
      and p_usuario = any(r.owner_agencia);
  get diagnostics v_tareas = row_count;

  -- 4) Recurrencias de fees que llevaba la persona.
  update public.recurrencias set owner_ejecutiva = p_reasignar_a
    where tenant_id = p_tenant and owner_ejecutiva = p_usuario;
  get diagnostics v_recurrencias = row_count;

  return jsonb_build_object(
    'api_keys_revocadas', v_keys, 'tokens_oauth_borrados', v_tokens, 'codigos_oauth_borrados', v_codigos,
    'tareas_reasignadas', v_tareas, 'recurrencias_reasignadas', v_recurrencias
  );
end $$;
revoke all on function public.quitar_acceso(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.quitar_acceso(uuid, uuid, uuid, uuid) to service_role;

-- ============================================================================
-- Verificación después de aplicar (solo lectura; 5 filas en true):
--   select 'crear_lote invoker' as control, not p.prosecdef as ok from pg_proc p where p.proname = 'crear_lote'
--   union all select '_insertar_fila invoker', not p.prosecdef from pg_proc p where p.proname = '_insertar_fila'
--   union all select 'quitar_acceso definer', p.prosecdef from pg_proc p where p.proname = 'quitar_acceso'
--   union all select 'quitar_acceso sin authenticated', not has_function_privilege('authenticated', 'public.quitar_acceso(uuid,uuid,uuid,uuid)', 'execute')
--   union all select 'crear_lote sin anon', not has_function_privilege('anon', 'public.crear_lote(jsonb,jsonb)', 'execute');
-- Luego: notify pgrst, 'reload schema';
-- ============================================================================
