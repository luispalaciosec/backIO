-- Auditoría de seguridad run-1 (30/09/2026): los hallazgos que se corrigen en la base.
-- ZONA DE REVISIÓN HUMANA (CLAUDE.md): toca el alta de usuarios (trigger sobre auth.users), grants de funciones
-- y una restricción de tabla. Idempotente.
-- Todo va con esquema explícito (public.): el editor SQL de Supabase no siempre tiene public en el search_path y
-- el %rowtype se resuelve al crear la función (primer intento: «relation "invitaciones" does not exist»).
--
--  1. backio/identity/handle-new-auth-user-provisions-unconfirmed-email
--     handle_new_auth_user daba de alta en usuarios al INSERTAR en auth.users, sin exigir correo confirmado:
--     si el registro público quedara abierto, cualquiera con un correo @geeks.com.ec / @geeks.ec (sin serlo) entraba
--     como colaborador, o se adueñaba de una invitación pendiente con su rol.
--     Ahora el alta ocurre solo con el correo confirmado: al insertar si ya viene confirmado (p. ej. Google), o cuando
--     se confirma (aceptar la invitación confirma el correo). Efecto visible: la persona invitada aparece en
--     Admin → Usuarios cuando abre el enlace y define su clave, no antes (mientras tanto sigue en «Invitaciones»).
--  2. secdef:ensure_semana-proyectos_recalcular_estado:no-caller-tenant-check
--     Dos funciones SECURITY DEFINER con EXECUTE por defecto para PUBLIC y sin chequeo de tenant.
--  3. frontend/stored-href/basecamp_url-no-scheme-filter (segunda capa; el frontend ya filtra el enlace)
--     basecamp_url solo acepta https.

-- ============================================================================
-- 1. Alta de usuarios solo con correo confirmado
-- ============================================================================
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(new.email);
  v_inv   public.invitaciones%rowtype;
  v_tenant uuid;
  v_nombre text;
begin
  if v_email is null then return new; end if;
  -- Sin correo confirmado no hay alta: nadie prueba ser dueño de la dirección solo por registrarse con ella.
  if new.email_confirmed_at is null then return new; end if;

  select * into v_inv from public.invitaciones where lower(email) = v_email and usada_at is null limit 1;

  if found then
    insert into public.usuarios (id, tenant_id, nombre, email, rol, capacidad_semanal)
    values (new.id, v_inv.tenant_id, v_inv.nombre, v_email, v_inv.rol, v_inv.capacidad_semanal)
    on conflict (id) do nothing;
    update public.invitaciones set usada_at = now() where id = v_inv.id;
    return new;
  end if;

  select id into v_tenant from public.tenants
  where activo and split_part(v_email, '@', 2) = any(dominios_auto)
  limit 1;

  if v_tenant is not null then
    v_nombre := coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', initcap(replace(split_part(v_email, '@', 1), '.', ' ')));
    insert into public.usuarios (id, tenant_id, nombre, email, rol)
    values (new.id, v_tenant, v_nombre, v_email, 'colaborador')
    on conflict (id) do nothing;
  end if;
  return new;
end $$;

-- El de INSERT se mantiene (usuarios que llegan ya confirmados); el nuevo cubre la confirmación posterior.
drop trigger if exists trg_on_auth_user_confirmed on auth.users;
create trigger trg_on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.handle_new_auth_user();

-- ============================================================================
-- 2. Funciones SECURITY DEFINER: sin acceso anónimo y con chequeo de tenant
-- ============================================================================
-- ensure_semana la llama el backend con la sesión del usuario (lib/db/semanas.ts) y con service role:
-- se mantiene para authenticated, pero solo sobre el propio tenant.
create or replace function public.ensure_semana(p_tenant uuid, p_fecha date) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_anio int := extract(isoyear from p_fecha);
  v_num  int := extract(week from p_fecha);
  v_ini  date := date_trunc('week', p_fecha)::date;   -- lunes
  v_id   uuid;
begin
  if auth.uid() is not null and p_tenant is distinct from public.auth_tenant_id() then
    raise exception 'Tenant no permitido' using errcode = 'insufficient_privilege';
  end if;
  insert into public.semanas (tenant_id, anio, numero_iso, fecha_inicio, fecha_fin)
  values (p_tenant, v_anio, v_num, v_ini, v_ini + 6)
  on conflict (tenant_id, anio, numero_iso) do update set fecha_inicio = excluded.fecha_inicio
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.ensure_semana(uuid, date) from public, anon;
grant execute on function public.ensure_semana(uuid, date) to authenticated, service_role;

-- proyectos_recalcular_estado solo la usa el trigger de requerimientos (security definer, corre como dueño).
revoke all on function public.proyectos_recalcular_estado(uuid) from public, anon, authenticated;
grant execute on function public.proyectos_recalcular_estado(uuid) to service_role;

-- ============================================================================
-- 3. basecamp_url solo https
-- NOT VALID: se exige en toda escritura nueva sin revisar las filas viejas (el backend siempre guardó app_url de
-- Basecamp, que es https). Para validarlas también:
--   select id, basecamp_url from requerimientos where basecamp_url is not null and basecamp_url !~ '^https://';
--   -- si no devuelve filas:  alter table requerimientos validate constraint requerimientos_basecamp_url_https;
-- ============================================================================
alter table public.requerimientos drop constraint if exists requerimientos_basecamp_url_https;
alter table public.requerimientos add constraint requerimientos_basecamp_url_https
  check (basecamp_url is null or basecamp_url ~ '^https://') not valid;

-- ============================================================================
-- Verificación después de aplicar (solo lectura; 5 filas, todas en true):
--   select 'alta exige confirmación' as control, prosrc like '%email_confirmed_at is null%' as ok from pg_proc where proname = 'handle_new_auth_user'
--   union all select 'trigger de confirmación', count(*) = 1 from pg_trigger where tgname = 'trg_on_auth_user_confirmed'
--   union all select 'ensure_semana chequea tenant', prosrc like '%auth_tenant_id()%' from pg_proc where proname = 'ensure_semana'
--   union all select 'anon sin ensure_semana', not has_function_privilege('anon', 'public.ensure_semana(uuid,date)', 'execute')
--   union all select 'authenticated sin recalcular', not has_function_privilege('authenticated', 'public.proyectos_recalcular_estado(uuid)', 'execute');
-- ============================================================================
