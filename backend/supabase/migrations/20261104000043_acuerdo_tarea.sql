-- Migración 43 · 4/11/2026 · acuerdo del weekly vinculado a una tarea (docs/05): lo que se acordó sobre una tarea sale como
-- sugerencia al armar el daily. Es opcional: un acuerdo puede no ser de ninguna tarea. No cambia las políticas RLS de acuerdos.

alter table acuerdos add column if not exists requerimiento_id uuid references requerimientos(id);
create index if not exists idx_acuerdos_requerimiento on acuerdos (tenant_id, requerimiento_id) where requerimiento_id is not null;

-- Verificación (esperado: true, 0).
select
  exists (select 1 from information_schema.columns where table_name = 'acuerdos' and column_name = 'requerimiento_id') as columna,
  (select count(*) from acuerdos where requerimiento_id is not null) as vinculados;
