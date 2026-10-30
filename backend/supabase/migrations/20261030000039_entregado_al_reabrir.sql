-- Migración 39 · 30/10/2026 · la entrega declarada se borra al reabrir la tarea.
--
-- «¿Ya se entregó?» (migración 38) guarda entregado_el, que manda sobre el cierre para «a tiempo». Si la tarea se reabre
-- (reproceso o desmarcada en Basecamp), esa entrega ya no vale: se borra junto con completado_at y responsables_cierre,
-- y la tarea vuelve a preguntarse si pasa su fecha. Misma función que la migración 30, con esas tres líneas.

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
    new.entregado_el = null;
    new.entregado_por = null;
    new.entregado_registrado_at = null;
  end if;

  return new;
end $$;

-- Verificación: la función nueva limpia entregado_el (esperado: true).
select position('new.entregado_el = null' in pg_get_functiondef('requerimientos_before_update'::regproc)) > 0 as limpia_entrega;
