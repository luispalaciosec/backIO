-- ============================================================================
-- Fase 0 · Triggers, vistas e índices
-- ============================================================================

-- ---------------------------------------------------------------- updated_at automático
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger trg_tenants_updated_at        before update on tenants        for each row execute function set_updated_at();
create trigger trg_usuarios_updated_at       before update on usuarios       for each row execute function set_updated_at();
create trigger trg_clientes_updated_at       before update on clientes       for each row execute function set_updated_at();
create trigger trg_plantillas_updated_at     before update on plantillas     for each row execute function set_updated_at();
create trigger trg_proyectos_updated_at      before update on proyectos      for each row execute function set_updated_at();
create trigger trg_requerimientos_updated_at before update on requerimientos for each row execute function set_updated_at();

-- ---------------------------------------------------------------- Defensa 2: visibilidad monotónica
-- visible_cliente se hereda de la plantilla. Solo se puede restringir, nunca abrir.
-- Enforced en base de datos: ni UI, ni API, ni agente LLM pueden saltárselo.
create or replace function enforce_visibilidad_monotonica() returns trigger
language plpgsql as $$
begin
  if new.visible_cliente = true and old.visible_cliente = false then
    raise exception 'No se puede abrir visibilidad al cliente. Se hereda de plantilla.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger trg_visibilidad_monotonica
  before update on requerimientos
  for each row execute function enforce_visibilidad_monotonica();

-- ---------------------------------------------------------------- Auditoría de reprogramación y movimiento
create or replace function requerimientos_before_insert() returns trigger
language plpgsql as $$
begin
  if new.fecha_entrega_original is null then
    new.fecha_entrega_original = new.fecha_entrega;
  end if;
  return new;
end $$;

create trigger trg_requerimientos_before_insert
  before insert on requerimientos
  for each row execute function requerimientos_before_insert();

create or replace function requerimientos_before_update() returns trigger
language plpgsql as $$
begin
  -- Cada cambio de fecha_entrega cuenta como reprogramación (mide arrastre).
  if new.fecha_entrega is distinct from old.fecha_entrega and old.fecha_entrega is not null then
    new.veces_reprogramado = old.veces_reprogramado + 1;
    if new.estado_operativo not in ('completado','cancelado') then
      new.estado_operativo = 'reprogramado';
    end if;
  end if;

  -- Cualquier cambio sustantivo mueve ultima_actualizacion (base de dias_sin_movimiento).
  if (new.estado_operativo   is distinct from old.estado_operativo)
  or (new.estado_aprobacion  is distinct from old.estado_aprobacion)
  or (new.fecha_entrega      is distinct from old.fecha_entrega)
  or (new.owner_agencia      is distinct from old.owner_agencia)
  or (new.prioridad          is distinct from old.prioridad)
  or (new.entregable_urls    is distinct from old.entregable_urls) then
    new.ultima_actualizacion = now();
  end if;

  if new.estado_operativo = 'completado' and old.estado_operativo <> 'completado' and new.completado_at is null then
    new.completado_at = now();
  end if;
  if new.estado_operativo <> 'completado' and old.estado_operativo = 'completado' then
    new.completado_at = null;
  end if;

  return new;
end $$;

create trigger trg_requerimientos_before_update
  before update on requerimientos
  for each row execute function requerimientos_before_update();

-- ---------------------------------------------------------------- Vista de métricas
-- dias_sin_movimiento es el campo más importante del sistema: detecta tableros muertos.
create or replace view v_requerimientos_metricas
with (security_invoker = true) as
select
  r.*,
  case
    when r.estado_operativo in ('completado','cancelado') then 0
    when r.fecha_entrega is null then 0
    else greatest(0, ((now() at time zone 'America/Guayaquil')::date - r.fecha_entrega))
  end as dias_atraso,
  greatest(0, extract(epoch from (now() - r.ultima_actualizacion)) / 86400)::int as dias_sin_movimiento,
  case when r.estado_operativo = 'completado' then r.peso else 0 end as peso_completado
from requerimientos r
where r.deleted_at is null;

-- Avance ponderado interno por proyecto (sobre TODAS las tareas; el cliente usa sanitizeForClient)
create or replace view v_proyectos_avance
with (security_invoker = true) as
select
  p.id as proyecto_id,
  p.tenant_id,
  p.cliente_id,
  coalesce(sum(r.peso), 0) as peso_total,
  coalesce(sum(case when r.estado_operativo = 'completado' then r.peso else 0 end), 0) as peso_completado,
  case when coalesce(sum(r.peso),0) = 0 then 0
       else round(100 * sum(case when r.estado_operativo = 'completado' then r.peso else 0 end) / sum(r.peso))
  end::int as avance,
  count(r.id) filter (where r.estado_operativo not in ('completado','cancelado') and r.fecha_entrega < (now() at time zone 'America/Guayaquil')::date) as atrasados,
  count(r.id) filter (where r.estado_aprobacion = 'pendiente_cliente') as esperando_cliente
from proyectos p
left join requerimientos r on r.proyecto_id = p.id and r.deleted_at is null and r.estado_operativo <> 'cancelado'
where p.deleted_at is null
group by p.id;

-- ---------------------------------------------------------------- Índices
create index idx_req_tenant             on requerimientos(tenant_id) where deleted_at is null;
create index idx_req_cliente_estado     on requerimientos(cliente_id, estado_operativo) where deleted_at is null;
create index idx_req_proyecto           on requerimientos(proyecto_id) where deleted_at is null;
create index idx_req_fecha_entrega      on requerimientos(fecha_entrega) where deleted_at is null;
create index idx_req_owner              on requerimientos using gin(owner_agencia);
create index idx_req_ultima_act         on requerimientos(ultima_actualizacion);
create unique index idx_req_basecamp    on requerimientos(basecamp_todo_id) where basecamp_todo_id is not null;
create index idx_proy_tenant_cliente    on proyectos(tenant_id, cliente_id) where deleted_at is null;
create index idx_proy_portal_token      on proyectos(portal_token) where portal_token is not null;
create index idx_senales_semana         on senales(semana_id, atendida);
create index idx_acuerdos_pendientes    on acuerdos(tenant_id, fecha_compromiso) where estado = 'pendiente';
create index idx_clientes_tenant_activo on clientes(tenant_id) where activo = true and deleted_at is null;
create index idx_bloques_plantilla      on plantilla_bloques(plantilla_id, orden);
create index idx_tareas_bloque          on plantilla_tareas(bloque_id, orden);

-- ---------------------------------------------------------------- Helper: semana ISO
create or replace function ensure_semana(p_tenant uuid, p_fecha date) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_anio int := extract(isoyear from p_fecha);
  v_num  int := extract(week from p_fecha);
  v_ini  date := date_trunc('week', p_fecha)::date;   -- lunes
  v_id   uuid;
begin
  insert into semanas (tenant_id, anio, numero_iso, fecha_inicio, fecha_fin)
  values (p_tenant, v_anio, v_num, v_ini, v_ini + 6)
  on conflict (tenant_id, anio, numero_iso) do update set fecha_inicio = excluded.fecha_inicio
  returning id into v_id;
  return v_id;
end $$;
