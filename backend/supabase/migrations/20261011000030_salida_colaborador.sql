-- ============================================================================
-- Migración 30 · Salida de un colaborador (11/10/2026)
--
-- Quien se va se desactiva, nunca se borra. Esta migración agrega:
--   1. usuarios.fecha_salida y motivo_salida.
--   2. requerimiento_responsables: historial de quién fue responsable de cada tarea y desde/hasta cuándo.
--      Lo llena un trigger sobre owner_agencia, así cubre toda reasignación (pantalla, API, Basecamp, salida).
--   3. requerimientos.responsables_cierre: quiénes eran responsables cuando la tarea se completó. Las métricas de lo
--      cerrado leen esto y no owner_agencia, que puede cambiar después.
--   4. requerimientos.heredada: la tarea pasó a otra persona por una salida con poco margen (decisión de Luis,
--      11/10/2026: si la recibió con menos de 3 días hábiles para la entrega o ya vencida, el atraso no cuenta).
--   5. RPC salida_colaborador: reemplaza a quitar_acceso con un plan por tarea, proyecto, mesa, acuerdo y
--      recurrencia, en una transacción. Falla si el plan no cubre todo lo abierto de la persona.
--
-- Zona de revisión humana (RLS y funciones SECURITY DEFINER): no aplicar sin revisión de Luis.
-- ============================================================================

-- 1) Usuarios ----------------------------------------------------------------
alter table usuarios add column if not exists fecha_salida date;
alter table usuarios add column if not exists motivo_salida text check (char_length(motivo_salida) <= 300);

-- 2) Historial de responsables ----------------------------------------------
create table if not exists requerimiento_responsables (
  id               bigint generated always as identity primary key,
  tenant_id        uuid not null references tenants(id),
  requerimiento_id uuid not null references requerimientos(id) on delete cascade,
  usuario_id       uuid not null references usuarios(id),
  desde            timestamptz not null default now(),
  hasta            timestamptz,
  -- 'salida' cuando lo movió salida_colaborador; null para cualquier otro cambio.
  motivo           text check (motivo in ('salida')),
  constraint rango_valido check (hasta is null or hasta >= desde)
);
create index if not exists requerimiento_responsables_req on requerimiento_responsables (requerimiento_id, desde);
create index if not exists requerimiento_responsables_usuario on requerimiento_responsables (tenant_id, usuario_id);
-- Un solo tramo abierto por persona y tarea.
create unique index if not exists requerimiento_responsables_abierto
  on requerimiento_responsables (requerimiento_id, usuario_id) where hasta is null;

alter table requerimiento_responsables enable row level security;
-- Solo lectura para usuarios del tenant. Escribe únicamente el trigger (security definer).
create policy requerimiento_responsables_select on requerimiento_responsables
  for select to authenticated using (tenant_id = auth_tenant_id());

create or replace function requerimientos_registrar_responsables() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_motivo text := case when current_setting('backio.salida', true) = 'on' then 'salida' end;
  v_viejos uuid[] := case when tg_op = 'UPDATE' then coalesce(old.owner_agencia, '{}') else '{}' end;
  v_nuevos uuid[] := coalesce(new.owner_agencia, '{}');
begin
  if tg_op = 'UPDATE' and v_viejos = v_nuevos then return null; end if;
  -- Cierra el tramo de quien deja de ser responsable.
  update requerimiento_responsables set hasta = now()
    where requerimiento_id = new.id and hasta is null and not (usuario_id = any(v_nuevos));
  -- Abre tramo a quien entra (si ya tenía uno abierto, no se duplica).
  insert into requerimiento_responsables (tenant_id, requerimiento_id, usuario_id, desde, motivo)
    select new.tenant_id, new.id, u, now(), v_motivo
    from unnest(v_nuevos) as u
    where not (u = any(v_viejos))
      -- owner_agencia es un arreglo sin FK: un id que no es persona no rompe el guardado de la tarea.
      and exists (select 1 from usuarios x where x.id = u)
    on conflict (requerimiento_id, usuario_id) where hasta is null do nothing;
  return null;
end $$;

drop trigger if exists trg_requerimientos_responsables on requerimientos;
create trigger trg_requerimientos_responsables
  after insert or update of owner_agencia on requerimientos
  for each row execute function requerimientos_registrar_responsables();

-- Backfill: el reparto actual, desde que se creó cada tarea (no hay historia anterior).
insert into requerimiento_responsables (tenant_id, requerimiento_id, usuario_id, desde)
  select r.tenant_id, r.id, u, r.created_at
  from requerimientos r cross join lateral unnest(r.owner_agencia) as u
  where exists (select 1 from usuarios x where x.id = u)
on conflict do nothing;

-- 3 y 4) Responsables al cierre y tareas heredadas ---------------------------
alter table requerimientos add column if not exists responsables_cierre uuid[];
alter table requerimientos add column if not exists heredada boolean not null default false;

-- Backfill: para lo ya completado, lo mejor que se sabe es el reparto actual.
update requerimientos set responsables_cierre = owner_agencia
  where estado_operativo = 'completado' and responsables_cierre is null;

-- Misma función que la migración 19, con dos cambios:
--   · al completar se congela responsables_cierre; al reabrir se limpia;
--   · una reasignación hecha por salida_colaborador no reinicia «días sin movimiento» (la tarea no se movió).
create or replace function requerimientos_before_update() returns trigger
language plpgsql as $$
begin
  -- Cada cambio de fecha_entrega cuenta como reprogramación (mide arrastre) pero NO cambia el estado.
  if new.fecha_entrega is distinct from old.fecha_entrega and old.fecha_entrega is not null then
    new.veces_reprogramado = old.veces_reprogramado + 1;
  end if;

  if (new.estado_operativo   is distinct from old.estado_operativo)
  or (new.estado_aprobacion  is distinct from old.estado_aprobacion)
  or (new.fecha_entrega      is distinct from old.fecha_entrega)
  or (new.owner_agencia      is distinct from old.owner_agencia and coalesce(current_setting('backio.salida', true), '') <> 'on')
  or (new.prioridad          is distinct from old.prioridad)
  or (new.entregable_urls    is distinct from old.entregable_urls) then
    new.ultima_actualizacion = now();
  end if;

  if new.estado_operativo = 'completado' and old.estado_operativo <> 'completado' then
    if new.completado_at is null then new.completado_at = now(); end if;
    new.responsables_cierre = new.owner_agencia;
  end if;
  if new.estado_operativo <> 'completado' and old.estado_operativo = 'completado' then
    new.completado_at = null;
    new.responsables_cierre = null;
  end if;

  return new;
end $$;

-- Una tarea que nace completada (importación de Basecamp) también congela sus responsables.
create or replace function requerimientos_cierre_al_insertar() returns trigger
language plpgsql as $$
begin
  if new.estado_operativo = 'completado' and new.responsables_cierre is null then
    new.responsables_cierre = new.owner_agencia;
  end if;
  return new;
end $$;
drop trigger if exists trg_requerimientos_cierre_al_insertar on requerimientos;
create trigger trg_requerimientos_cierre_al_insertar
  before insert on requerimientos
  for each row execute function requerimientos_cierre_al_insertar();

-- El colaborador puede completar sus tareas sin enlace a Basecamp: responsables_cierre lo calcula el trigger en el
-- mismo update, así que entra en la lista blanca (misma función que la migración 25, una columna más).
create or replace function requerimientos_limitar_colaborador() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  permitidas text[] := array[
    'estado_operativo', 'fecha_entrega', 'entregable_urls', 'daily_fecha', 'piezas',
    'updated_at', 'updated_by', 'ultima_actualizacion', 'completado_at', 'veces_reprogramado', 'veces_reproceso',
    'responsables_cierre'];
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
  -- responsables_cierre solo puede ser el reparto actual (lo pone el trigger) o vaciarse al reabrir.
  if new.responsables_cierre is distinct from old.responsables_cierre
     and new.responsables_cierre is not null and new.responsables_cierre is distinct from new.owner_agencia then
    raise exception 'Los responsables al cierre no se editan a mano' using errcode = 'insufficient_privilege';
  end if;
  -- Regla 3: Basecamp manda sobre completed. Antes solo lo aplicaba la ruta del backend.
  if new.estado_operativo = 'completado' and old.estado_operativo is distinct from 'completado' and old.basecamp_todo_id is not null then
    raise exception 'Este requerimiento se completa desde Basecamp' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

-- 5) RPC de salida -----------------------------------------------------------
-- SECURITY DEFINER (toca credenciales que RLS no deja ver): solo el backend (service_role), que ya verificó que
-- quien llama es admin y armó el plan. Filtra todo por p_tenant.
--
-- p_plan:
--   { "tareas":       [{ "id": uuid, "a": uuid|null, "heredada": bool }],
--     "proyectos":    [{ "id": uuid, "a": uuid|null }],
--     "mesas":        [{ "id": uuid, "a": uuid|null }],
--     "acuerdos":     [{ "id": uuid, "a": uuid }],
--     "recurrencias": [{ "id": uuid, "a": uuid|null }] }
-- Cada destino debe ser una persona activa del tenant distinta de quien se va. Al final se verifica que no quede
-- nada abierto a nombre de la persona: si el plan no lo cubría (algo cambió desde la revisión), no se aplica nada.
create or replace function public.salida_colaborador(
  p_tenant uuid, p_usuario uuid, p_actor uuid, p_fecha date, p_motivo text, p_plan jsonb
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_keys int; v_tokens int; v_codigos int;
  v_tareas int := 0; v_proyectos int := 0; v_mesas int := 0; v_acuerdos int := 0; v_recurrencias int := 0;
  v_destinos uuid[];
  v_pendiente text;
begin
  if not exists (select 1 from usuarios where id = p_usuario and tenant_id = p_tenant) then
    raise exception 'Usuario no encontrado en el tenant' using errcode = 'P0002';
  end if;
  if p_usuario = p_actor then
    raise exception 'No puedes registrar tu propia salida' using errcode = '22023';
  end if;

  -- Destinos: personas activas del tenant, distintas de quien se va.
  select array_agg(distinct (x->>'a')::uuid) into v_destinos
    from jsonb_path_query(p_plan, '$.*[*]') as x
    where x->>'a' is not null;
  if exists (
    select 1 from unnest(coalesce(v_destinos, '{}')) d
    where d = p_usuario or not exists (select 1 from usuarios u where u.id = d and u.tenant_id = p_tenant and u.activo)
  ) then
    raise exception 'Hay un destino que no es una persona activa del equipo' using errcode = '22023';
  end if;

  -- La reasignación no reinicia «días sin movimiento» y queda marcada en el historial como 'salida'.
  perform set_config('backio.salida', 'on', true);

  -- Tareas abiertas: quitar a la persona y sumar el destino (sin duplicar).
  with plan as (
    select (x->>'id')::uuid as id, (x->>'a')::uuid as a, coalesce((x->>'heredada')::boolean, false) as heredada
    from jsonb_array_elements(coalesce(p_plan->'tareas', '[]')) x
  )
  update requerimientos r
    set owner_agencia = case
          when p.a is null or p.a = any(array_remove(r.owner_agencia, p_usuario)) then array_remove(r.owner_agencia, p_usuario)
          else array_append(array_remove(r.owner_agencia, p_usuario), p.a)
        end,
        heredada = r.heredada or (p.a is not null and p.heredada),
        updated_by = p_actor
    from plan p
    where r.id = p.id and r.tenant_id = p_tenant and r.deleted_at is null
      and r.estado_operativo not in ('completado', 'cancelado')
      and p_usuario = any(r.owner_agencia);
  get diagnostics v_tareas = row_count;

  -- Proyectos abiertos donde es la ejecutiva.
  with plan as (select (x->>'id')::uuid as id, (x->>'a')::uuid as a from jsonb_array_elements(coalesce(p_plan->'proyectos', '[]')) x)
  update proyectos pr set owner_ejecutiva = p.a, updated_by = p_actor
    from plan p
    where pr.id = p.id and pr.tenant_id = p_tenant and pr.owner_ejecutiva = p_usuario;
  get diagnostics v_proyectos = row_count;

  -- Mesas que lidera.
  with plan as (select (x->>'id')::uuid as id, (x->>'a')::uuid as a from jsonb_array_elements(coalesce(p_plan->'mesas', '[]')) x)
  update mesas m set lider_id = p.a
    from plan p
    where m.id = p.id and m.tenant_id = p_tenant and m.lider_id = p_usuario;
  get diagnostics v_mesas = row_count;

  -- Acuerdos pendientes del weekly (responsable obligatorio).
  with plan as (select (x->>'id')::uuid as id, (x->>'a')::uuid as a from jsonb_array_elements(coalesce(p_plan->'acuerdos', '[]')) x)
  update acuerdos ac set responsable_id = p.a
    from plan p
    where ac.id = p.id and ac.tenant_id = p_tenant and ac.responsable_id = p_usuario and ac.estado = 'pendiente'
      and p.a is not null;
  get diagnostics v_acuerdos = row_count;

  -- Recurrencias: la ejecutiva y los responsables de bloque que eran de la persona.
  with plan as (select (x->>'id')::uuid as id, (x->>'a')::uuid as a from jsonb_array_elements(coalesce(p_plan->'recurrencias', '[]')) x)
  update recurrencias rc
    set owner_ejecutiva = case when rc.owner_ejecutiva = p_usuario then p.a else rc.owner_ejecutiva end,
        bloques = coalesce((
          select jsonb_agg(case when b->>'owner_id' = p_usuario::text
                                then jsonb_set(b, '{owner_id}', coalesce(to_jsonb(p.a), 'null'::jsonb)) else b end
                           order by i)
          from jsonb_array_elements(rc.bloques) with ordinality as e(b, i)
        ), rc.bloques)
    from plan p
    where rc.id = p.id and rc.tenant_id = p_tenant
      and (rc.owner_ejecutiva = p_usuario or rc.bloques @> jsonb_build_array(jsonb_build_object('owner_id', p_usuario)));
  get diagnostics v_recurrencias = row_count;

  -- Nada abierto puede quedar a su nombre.
  select case
    when exists (select 1 from requerimientos where tenant_id = p_tenant and deleted_at is null
                   and estado_operativo not in ('completado', 'cancelado') and p_usuario = any(owner_agencia)) then 'tareas'
    when exists (select 1 from proyectos where tenant_id = p_tenant and deleted_at is null
                   and estado not in ('completado', 'cancelado') and owner_ejecutiva = p_usuario) then 'proyectos'
    when exists (select 1 from mesas where tenant_id = p_tenant and lider_id = p_usuario) then 'mesas'
    when exists (select 1 from acuerdos where tenant_id = p_tenant and estado = 'pendiente' and responsable_id = p_usuario) then 'acuerdos'
    when exists (select 1 from recurrencias where tenant_id = p_tenant and (owner_ejecutiva = p_usuario
                   or bloques @> jsonb_build_array(jsonb_build_object('owner_id', p_usuario)))) then 'recurrencias'
  end into v_pendiente;
  if v_pendiente is not null then
    raise exception 'El plan no cubre todas sus %: vuelve a revisar la salida', v_pendiente using errcode = '22023';
  end if;

  -- Credenciales: API keys creadas por la persona, tokens y códigos OAuth.
  update api_keys set revocada_at = now() where tenant_id = p_tenant and creado_por = p_usuario and revocada_at is null;
  get diagnostics v_keys = row_count;
  delete from oauth_tokens where tenant_id = p_tenant and usuario_id = p_usuario;
  get diagnostics v_tokens = row_count;
  delete from oauth_codes where tenant_id = p_tenant and usuario_id = p_usuario;
  get diagnostics v_codigos = row_count;

  update usuarios set activo = false, fecha_salida = p_fecha, motivo_salida = nullif(trim(p_motivo), '')
    where id = p_usuario and tenant_id = p_tenant;

  return jsonb_build_object(
    'tareas', v_tareas, 'proyectos', v_proyectos, 'mesas', v_mesas, 'acuerdos', v_acuerdos,
    'recurrencias', v_recurrencias, 'api_keys_revocadas', v_keys, 'tokens_oauth_borrados', v_tokens,
    'codigos_oauth_borrados', v_codigos
  );
end $$;
revoke all on function public.salida_colaborador(uuid, uuid, uuid, date, text, jsonb) from public, anon, authenticated;
grant execute on function public.salida_colaborador(uuid, uuid, uuid, date, text, jsonb) to service_role;

-- quitar_acceso queda sin uso cuando el backend nuevo esté desplegado; se borra en una migración posterior.

-- ============================================================================
-- Verificación después de aplicar (solo lectura):
--   select count(*) as tramos, count(distinct requerimiento_id) as tareas from requerimiento_responsables;
--   select count(*) filter (where responsables_cierre is null) as completadas_sin_cierre
--     from requerimientos where estado_operativo = 'completado';                               -- 0
--   select tgname from pg_trigger where tgname in ('trg_requerimientos_responsables', 'trg_requerimientos_cierre_al_insertar');
--   select polname from pg_policy where polrelid = 'requerimiento_responsables'::regclass;   -- solo _select
--   select prosecdef from pg_proc where proname = 'salida_colaborador';                     -- true
--   select has_function_privilege('authenticated', 'public.salida_colaborador(uuid,uuid,uuid,date,text,jsonb)', 'execute'); -- false
-- RLS con otro tenant: como usuario de prueba de otro tenant,
--   select count(*) from requerimiento_responsables;                                          -- 0
-- ============================================================================
