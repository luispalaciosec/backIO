-- Migración 47 · 9/11/2026 · limpieza de la auditoría (aprobada por Luis). BORRADO PERMANENTE.
--
-- Borra solo los registros «basecamp_importar» de sincronizaciones que no cambiaron nada: el 9/11/2026 eran casi todo
-- el audit_log. Los que trajeron cambios se conservan, y ninguna otra acción se toca. Desde esta fecha ya no se generan.
--
-- Es una sola instrucción, de a 20.000 para no saturar una base con poca memoria.
-- CORRER VARIAS VECES, sin seleccionar texto, hasta que `borradas` dé 0.

with lote as (
  select id
  from audit_log
  where accion = 'basecamp_importar'
    and coalesce((detalle->>'proyectos_creados')::int, 0) = 0
    and coalesce((detalle->>'requerimientos_creados')::int, 0) = 0
    and coalesce((detalle->>'responsables_actualizados')::int, 0) = 0
    and coalesce((detalle->>'titulos_actualizados')::int, 0) = 0
    and coalesce((detalle->>'movidos')::int, 0) = 0
    and coalesce((detalle->>'proyectos_renombrados')::int, 0) = 0
    and coalesce((detalle->>'eliminados_en_basecamp')::int, 0) = 0
    and coalesce((detalle->>'movidos_a_otro_proyecto')::int, 0) = 0
  limit 20000
),
borrado as (
  delete from audit_log a using lote where a.id = lote.id returning 1
)
select count(*) as borradas from borrado;
