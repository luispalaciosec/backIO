-- Migración 46 · 4/11/2026 · acuerdo del weekly vinculado a un proyecto (docs/05): el weekly se revisa por proyecto y lo
-- acordado se ve en su fila. Es opcional: un acuerdo puede no ser de ningún proyecto. No cambia las políticas RLS de acuerdos.

alter table acuerdos add column if not exists proyecto_id uuid references proyectos(id);
create index if not exists idx_acuerdos_proyecto on acuerdos (tenant_id, proyecto_id) where proyecto_id is not null;

-- Verificación (esperado: true, 0).
select
  exists (select 1 from information_schema.columns where table_name = 'acuerdos' and column_name = 'proyecto_id') as columna,
  (select count(*) from acuerdos where proyecto_id is not null) as vinculados;
