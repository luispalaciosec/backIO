-- Estado del proyecto derivado de sus tareas (pedido de Luis 07/09/2026).
-- Regla: si todas las tareas no canceladas están completadas → proyecto 'completado'.
--        si el proyecto estaba 'completado' y alguna tarea se reabre → 'en_ejecucion'.
-- No toca proyectos 'cancelado' ni proyectos sin tareas. El estado sigue siendo editable a mano.
create or replace function proyectos_recalcular_estado(p_proyecto uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_total int; v_completadas int; v_estado text;
begin
  if p_proyecto is null then return; end if;
  select estado into v_estado from proyectos where id = p_proyecto and deleted_at is null;
  if v_estado is null or v_estado = 'cancelado' then return; end if;
  select count(*), count(*) filter (where estado_operativo = 'completado')
    into v_total, v_completadas
  from requerimientos where proyecto_id = p_proyecto and deleted_at is null and estado_operativo <> 'cancelado';
  if v_total = 0 then return; end if;
  if v_completadas = v_total and v_estado <> 'completado' then
    update proyectos set estado = 'completado', updated_at = now() where id = p_proyecto;
  elsif v_completadas < v_total and v_estado = 'completado' then
    update proyectos set estado = 'en_ejecucion', updated_at = now() where id = p_proyecto;
  end if;
end $$;

create or replace function requerimientos_after_change_estado_proyecto() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then perform proyectos_recalcular_estado(old.proyecto_id); return old; end if;
  if tg_op = 'UPDATE' and new.estado_operativo is not distinct from old.estado_operativo and new.deleted_at is not distinct from old.deleted_at and new.proyecto_id is not distinct from old.proyecto_id then return new; end if;
  perform proyectos_recalcular_estado(new.proyecto_id);
  if tg_op = 'UPDATE' and old.proyecto_id is distinct from new.proyecto_id then perform proyectos_recalcular_estado(old.proyecto_id); end if;
  return new;
end $$;
drop trigger if exists trg_requerimientos_estado_proyecto on requerimientos;
create trigger trg_requerimientos_estado_proyecto
  after insert or update or delete on requerimientos for each row execute function requerimientos_after_change_estado_proyecto();

-- Backfill: proyectos que ya tienen todo completado.
do $$ declare r record; begin
  for r in select id from proyectos where deleted_at is null and estado not in ('completado','cancelado') loop
    perform proyectos_recalcular_estado(r.id);
  end loop;
end $$;
