-- Migración 41 · 30/10/2026 · rentabilidad por cliente (docs/21). ZONA DE REVISIÓN: políticas RLS.
--
-- Sueldos y fees los ven y los cargan SOLO gerencia y admin (decisión de Luis, 30/10/2026). Van en tablas aparte porque
-- `usuarios` y `clientes` las lee todo el tenant. El backend vuelve a validar el rol en cada ruta.
--
-- 1. auth_es_gerencia_o_admin(): rol admin o gerencia, usuario activo (como auth_es_admin desde la migración 25).
-- 2. costos_personal: sueldo mensual de cada persona desde una fecha (el vigente es el último con desde <= el mes).
-- 3. fees_cliente: cuánto paga cada cliente al mes desde una fecha (mismo criterio).
-- Sin borrado desde la app: un cambio de sueldo o de fee es una fila nueva con su fecha, y queda la historia.
-- Nada de esto va en docs/ (es pública).

create or replace function auth_es_gerencia_o_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select rol in ('admin', 'gerencia') from usuarios where id = auth.uid() and activo), false)
$$;
revoke all on function auth_es_gerencia_o_admin() from public;
grant execute on function auth_es_gerencia_o_admin() to authenticated;

create table if not exists costos_personal (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  usuario_id      uuid not null references usuarios(id),
  sueldo_mensual  numeric(12, 2) not null check (sueldo_mensual > 0),
  desde           date not null,
  created_by      uuid references usuarios(id),
  created_at      timestamptz not null default now(),
  unique (tenant_id, usuario_id, desde)
);

create table if not exists fees_cliente (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  cliente_id   uuid not null references clientes(id),
  fee_mensual  numeric(12, 2) not null check (fee_mensual >= 0),
  desde        date not null,
  created_by   uuid references usuarios(id),
  created_at   timestamptz not null default now(),
  unique (tenant_id, cliente_id, desde)
);

alter table costos_personal enable row level security;
alter table fees_cliente enable row level security;

create policy costos_personal_select on costos_personal for select to authenticated
  using (tenant_id = auth_tenant_id() and auth_es_gerencia_o_admin());
create policy costos_personal_insert on costos_personal for insert to authenticated
  with check (tenant_id = auth_tenant_id() and auth_es_gerencia_o_admin());
create policy costos_personal_update on costos_personal for update to authenticated
  using (tenant_id = auth_tenant_id() and auth_es_gerencia_o_admin())
  with check (tenant_id = auth_tenant_id() and auth_es_gerencia_o_admin());

create policy fees_cliente_select on fees_cliente for select to authenticated
  using (tenant_id = auth_tenant_id() and auth_es_gerencia_o_admin());
create policy fees_cliente_insert on fees_cliente for insert to authenticated
  with check (tenant_id = auth_tenant_id() and auth_es_gerencia_o_admin());
create policy fees_cliente_update on fees_cliente for update to authenticated
  using (tenant_id = auth_tenant_id() and auth_es_gerencia_o_admin())
  with check (tenant_id = auth_tenant_id() and auth_es_gerencia_o_admin());

-- Verificación (esperado: true, true, 3, 3, true).
select
  (select relrowsecurity from pg_class where relname = 'costos_personal') as costos_rls,
  (select relrowsecurity from pg_class where relname = 'fees_cliente') as fees_rls,
  (select count(*) from pg_policies where tablename = 'costos_personal') as politicas_costos,
  (select count(*) from pg_policies where tablename = 'fees_cliente') as politicas_fees,
  (select prosecdef from pg_proc where proname = 'auth_es_gerencia_o_admin') as funcion_security_definer;
