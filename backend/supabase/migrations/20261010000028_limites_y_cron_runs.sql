-- Auditoría externa del 10/10/2026 · Ola 3 y Ola 5: estado operativo que no debe vivir en memoria.
-- ZONA DE REVISIÓN HUMANA (CLAUDE.md): crea tablas sin políticas y una función SECURITY DEFINER. Idempotente.
-- Todo con esquema explícito (public.).
--
--  Punto 11 · Límite de peticiones persistente. Los contadores en memoria (PIN del portal, MCP, recuperar contraseña)
--             se perdían en cada reinicio o despliegue y no se compartían entre réplicas. Aquí viven en Postgres.
--  B10      · cron_runs: cada job programado registra la ventana que ya ejecutó (p. ej. «foto_daily:2026-10-12»),
--             para que un tick perdido se recupere y dos réplicas no repitan el mismo job (lo usa la Ola 5).

-- ============================================================================
-- Límite de peticiones (ventana fija)
-- ============================================================================
create table if not exists public.limites (
  clave          text primary key,          -- p. ej. «oauth_register:ip:203.0.113.7»
  ventana_inicio timestamptz not null,
  n              int not null default 0,
  bloqueado_hasta timestamptz
);
alter table public.limites enable row level security;
-- Sin políticas: solo el backend (service role).

-- Suma un intento a `p_clave` dentro de una ventana de `p_ventana_seg` segundos. Devuelve el conteo actual y si ya
-- pasó de `p_max` (en ese caso queda bloqueada hasta el fin de la ventana). Atómico por fila (upsert).
create or replace function public.limite_sumar(p_clave text, p_max int, p_ventana_seg int)
returns table (n int, excedido boolean, reintentar_en int)
language plpgsql security definer set search_path = public as $$
declare
  v public.limites%rowtype;
begin
  insert into public.limites as l (clave, ventana_inicio, n)
  values (p_clave, now(), 1)
  on conflict (clave) do update
    set n = case when l.ventana_inicio < now() - make_interval(secs => p_ventana_seg) then 1 else l.n + 1 end,
        ventana_inicio = case when l.ventana_inicio < now() - make_interval(secs => p_ventana_seg) then now() else l.ventana_inicio end
  returning * into v;
  return query select v.n, v.n > p_max,
    greatest(0, extract(epoch from (v.ventana_inicio + make_interval(secs => p_ventana_seg) - now()))::int);
end $$;
revoke all on function public.limite_sumar(text, int, int) from public, anon, authenticated;
grant execute on function public.limite_sumar(text, int, int) to service_role;

-- Consulta sin sumar (p. ej. ¿este PIN está bloqueado?) y borrado al acertar.
create or replace function public.limite_estado(p_clave text, p_max int, p_ventana_seg int)
returns table (n int, excedido boolean, reintentar_en int)
language sql stable security definer set search_path = public as $$
  select coalesce(l.n, 0),
         coalesce(l.n, 0) > p_max and l.ventana_inicio >= now() - make_interval(secs => p_ventana_seg),
         greatest(0, coalesce(extract(epoch from (l.ventana_inicio + make_interval(secs => p_ventana_seg) - now()))::int, 0))
  from (select 1) x left join public.limites l on l.clave = p_clave
$$;
revoke all on function public.limite_estado(text, int, int) from public, anon, authenticated;
grant execute on function public.limite_estado(text, int, int) to service_role;

-- Limpieza: filas viejas (llamada por el scheduler una vez al día).
create or replace function public.limites_limpiar() returns int
language sql security definer set search_path = public as $$
  with b as (delete from public.limites where ventana_inicio < now() - interval '2 days' returning 1) select count(*)::int from b
$$;
revoke all on function public.limites_limpiar() from public, anon, authenticated;
grant execute on function public.limites_limpiar() to service_role;

-- ============================================================================
-- Ejecuciones de jobs programados (Ola 5, B10)
-- ============================================================================
create table if not exists public.cron_runs (
  job          text not null,
  ventana      text not null,               -- clave de la ventana: día, semana o mes según el job
  inicio_at    timestamptz not null default now(),
  fin_at       timestamptz,
  ok           boolean,
  detalle      text,
  primary key (job, ventana)
);
alter table public.cron_runs enable row level security;
-- Sin políticas: solo el backend.

-- ============================================================================
-- Verificación después de aplicar (solo lectura; 5 filas en true):
--   select 'limites' as control, count(*) = 1 as ok from information_schema.tables where table_name = 'limites'
--   union all select 'cron_runs', count(*) = 1 from information_schema.tables where table_name = 'cron_runs'
--   union all select 'limite_sumar solo service_role', not has_function_privilege('authenticated', 'public.limite_sumar(text,int,int)', 'execute')
--   union all select 'limite_estado solo service_role', not has_function_privilege('anon', 'public.limite_estado(text,int,int)', 'execute')
--   union all select 'sin políticas', not exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname in ('limites', 'cron_runs'));
-- Si la API no ve las tablas nuevas enseguida: notify pgrst, 'reload schema';
-- ============================================================================
