-- ============================================================================
-- Mesas: equipos de cuenta (Orión, Omega). Cada mesa maneja N clientes y a veces proyectos
-- puntuales. Tiene su proyecto Basecamp donde se publican Plan Operativo y Acta de Cierre.
-- ============================================================================
create table mesas (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id),
  nombre              text not null,
  slug                text not null,
  basecamp_project_id bigint,            -- proyecto Basecamp de la mesa (actas, docs)
  lider_id            uuid references usuarios(id),
  color               text default '#0073EA',
  activa              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, slug)
);
alter table mesas enable row level security;
create policy mesas_select on mesas for select to authenticated using (tenant_id = auth_tenant_id());
create policy mesas_write on mesas for all to authenticated
  using (tenant_id = auth_tenant_id() and auth_es_gestion()) with check (tenant_id = auth_tenant_id() and auth_es_gestion());
create trigger trg_mesas_updated_at before update on mesas for each row execute function set_updated_at();

alter table clientes  add column if not exists mesa_id uuid references mesas(id);
alter table proyectos add column if not exists mesa_id uuid references mesas(id);   -- override: proyecto llevado por otra mesa
alter table actas     add column if not exists mesa_id uuid references mesas(id);
alter table semanas   add column if not exists plan_publicado_por_mesa jsonb not null default '{}'::jsonb;

create index if not exists idx_clientes_mesa on clientes(mesa_id);
create index if not exists idx_proyectos_mesa on proyectos(mesa_id);

insert into mesas (id, tenant_id, nombre, slug, basecamp_project_id, color) values
  ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Mesa Orión', 'orion', 41904747, '#0073EA'),
  ('40000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'Mesa Omega', 'omega', 41904721, '#A25DDC')
on conflict (tenant_id, slug) do update set basecamp_project_id = excluded.basecamp_project_id;
