-- ============================================================================
-- Migración 31 · La vista de métricas incluye las columnas de la migración 30 (11/10/2026)
--
-- v_requerimientos_metricas expande r.* al crearse: sin recrearla, responsables_cierre y heredada no llegan a
-- cumplimiento, dashboard, personas e informes. Misma definición que la migración 22.
-- Además se borra quitar_acceso, reemplazada por salida_colaborador (migración 30) y ya sin uso en el backend.
-- ============================================================================
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

drop function if exists public.quitar_acceso(uuid, uuid, uuid, uuid);

-- ============================================================================
-- Verificación después de aplicar (solo lectura):
--   select column_name from information_schema.columns
--    where table_name = 'v_requerimientos_metricas' and column_name in ('responsables_cierre', 'heredada');  -- 2 filas
--   select (select reloptions from pg_class where relname = 'v_requerimientos_metricas');                  -- {security_invoker=true}
--   select count(*) from pg_proc where proname = 'quitar_acceso';                                          -- 0
-- ============================================================================
