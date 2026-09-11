-- Feedback de Marcia (10/09/2026):
--  2) Reprogramar NO cambia el estado operativo (la tarea sigue "En proceso"; el arrastre se mide con veces_reprogramado).
--  3) Planificación: planificado | no_planificado | urgente (trabajo que entra fuera del weekly).
--  4) Daily: selección de tareas del día (daily_fecha).
alter table requerimientos add column if not exists planificacion text not null default 'planificado'
  check (planificacion in ('planificado','no_planificado','urgente'));
alter table requerimientos add column if not exists daily_fecha date;
create index if not exists requerimientos_daily_fecha on requerimientos (tenant_id, daily_fecha) where daily_fecha is not null;

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

-- La vista expande r.*: recrear para incluir las columnas nuevas.
drop view if exists v_requerimientos_metricas;
create view v_requerimientos_metricas
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
