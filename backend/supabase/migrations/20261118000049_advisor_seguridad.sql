-- Migración 49 · 18/11/2026 · avisos del Security Advisor de Supabase. ZONA DE REVISIÓN (funciones de RLS y triggers).
-- No cambia ningún resultado: fija el search_path y quita permisos de ejecución que nadie usa.
-- Aplicar DESPUÉS de reiniciar la base y con BackIO respondiendo. Una sola vez, completa.

begin;

-- 1. search_path fijo (lint 0011) en las 5 funciones de trigger que no lo tenían. Igual al que ya usan las demás.
alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.enforce_visibilidad_monotonica() set search_path = public, pg_temp;
alter function public.requerimientos_before_insert() set search_path = public, pg_temp;
alter function public.requerimientos_before_update() set search_path = public, pg_temp;
alter function public.requerimientos_cierre_al_insertar() set search_path = public, pg_temp;

-- 2. Funciones de trigger: se ejecutan solas al insertar o actualizar; nadie las llama por /rest/v1/rpc.
--    Quitar EXECUTE no afecta a los triggers (Postgres no revisa ese permiso al dispararlos).
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
revoke execute on function public.requerimientos_after_change_estado_proyecto() from public, anon, authenticated;
revoke execute on function public.requerimientos_after_update_reprogramacion() from public, anon, authenticated;
revoke execute on function public.requerimientos_limitar_colaborador() from public, anon, authenticated;
revoke execute on function public.requerimientos_registrar_aprobacion() from public, anon, authenticated;
revoke execute on function public.requerimientos_registrar_responsables() from public, anon, authenticated;
revoke execute on function public.requerimientos_visibilidad_insert() from public, anon, authenticated;
revoke execute on function public.usuarios_proteger_columnas() from public, anon, authenticated;

-- 3. Ayudas de RLS (auth_rol, auth_tenant_id…): las políticas las llaman con el rol de quien consulta, así que
--    `authenticated` las necesita. Solo se le quitan a `anon` (sin sesión no hay nada que leer).
--    ensure_semana la llama el backend con la sesión del usuario: queda para `authenticated`.
revoke execute on function public.auth_es_admin() from public, anon;
revoke execute on function public.auth_es_gerencia_o_admin() from public, anon;
revoke execute on function public.auth_es_gestion() from public, anon;
revoke execute on function public.auth_rol() from public, anon;
revoke execute on function public.auth_tenant_id() from public, anon;
grant execute on function public.auth_es_admin() to authenticated, service_role;
grant execute on function public.auth_es_gerencia_o_admin() to authenticated, service_role;
grant execute on function public.auth_es_gestion() to authenticated, service_role;
grant execute on function public.auth_rol() to authenticated, service_role;
grant execute on function public.auth_tenant_id() to authenticated, service_role;

commit;

-- Control: debe dar 0 filas.
select p.proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('set_updated_at','enforce_visibilidad_monotonica','requerimientos_before_insert',
                    'requerimientos_before_update','requerimientos_cierre_al_insertar')
  and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
union all
select p.proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');
