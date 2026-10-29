-- Migración 37 · 29/10/2026 · ejecutiva de cuenta por cliente (decisión de Luis).
--
-- La mesa es el equipo de producción que ejecuta (daily y weekly); la ejecutiva de cuenta es la dueña de la relación con
-- el cliente y puede tener cuentas en varias mesas (Grace lidera Orión y lleva Grupo Torres & Torres, que produce Omega).
-- La ejecutiva efectiva de un proyecto es proyectos.owner_ejecutiva si está, si no la del cliente.
-- Sin backfill: se asignan en Admin → Clientes o en la ficha del cliente. La tabla ya tiene RLS; no cambia.

alter table clientes add column if not exists ejecutiva_id uuid references usuarios(id);
create index if not exists idx_clientes_ejecutiva on clientes(tenant_id, ejecutiva_id);

-- Verificación: la columna existe (esperado: 1) y aún no hay clientes con ejecutiva (esperado: 0).
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'clientes' and column_name = 'ejecutiva_id') as columna,
  (select count(*) from clientes where ejecutiva_id is not null) as con_ejecutiva;
