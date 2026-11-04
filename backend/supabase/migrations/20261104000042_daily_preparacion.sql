-- Migración 42 · 4/11/2026 · daily compartido entre ejecutivas (docs/05). ZONA DE REVISIÓN: políticas RLS.
--
-- Una mesa puede tener varias ejecutivas (Omega: Carolina y Grace). Cada una deja aquí sus notas y, si quiere, marca
-- «Mi parte está lista». Es información para las demás: nadie queda esperando a nadie y cualquiera de gestión publica.
-- Al publicar, las notas de todas y sus nombres salen en un solo mensaje. La selección de tareas ya era compartida
-- (requerimientos.daily_fecha).
--
-- RLS: leen los roles de gestión del tenant. Cada persona escribe solo su propia fila (usuario_id = auth.uid()); las
-- demás se leen, no se tocan. Sin borrado: es la historia de quién preparó cada daily.

create table if not exists daily_preparacion (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  mesa_id     uuid not null references mesas(id),
  fecha       date not null,
  tipo        text not null check (tipo in ('apertura', 'cierre')),
  usuario_id  uuid not null references usuarios(id),
  notas       jsonb not null default '[]'::jsonb,
  listo_at    timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, mesa_id, fecha, tipo, usuario_id)
);
create index if not exists daily_preparacion_mesa on daily_preparacion (tenant_id, mesa_id, fecha, tipo);
create trigger trg_daily_preparacion_updated_at before update on daily_preparacion for each row execute function set_updated_at();

alter table daily_preparacion enable row level security;
create policy daily_preparacion_select on daily_preparacion for select to authenticated
  using (tenant_id = auth_tenant_id() and auth_es_gestion());
create policy daily_preparacion_insert on daily_preparacion for insert to authenticated
  with check (tenant_id = auth_tenant_id() and auth_es_gestion() and usuario_id = auth.uid());
create policy daily_preparacion_update on daily_preparacion for update to authenticated
  using (tenant_id = auth_tenant_id() and auth_es_gestion() and usuario_id = auth.uid())
  with check (tenant_id = auth_tenant_id() and auth_es_gestion() and usuario_id = auth.uid());

-- Verificación (esperado: true, 3).
select
  (select relrowsecurity from pg_class where relname = 'daily_preparacion') as preparacion_rls,
  (select count(*) from pg_policies where tablename = 'daily_preparacion') as politicas;
