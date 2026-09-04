-- Sprint 3 · Horas (timesheet de Basecamp por to-do) y to-dos huérfanos (creados fuera de BackIO).
create table horas (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id),
  cliente_id          uuid references clientes(id),
  requerimiento_id    uuid references requerimientos(id) on delete set null,
  usuario_id          uuid references usuarios(id),
  basecamp_entry_id   bigint not null,
  basecamp_person_id  bigint,
  basecamp_todo_id    bigint,
  basecamp_project_id bigint,
  fecha               date not null,
  horas               numeric(6,2) not null check (horas >= 0),
  sincronizado_at     timestamptz not null default now(),
  unique (tenant_id, basecamp_entry_id)
);
-- SOLO números e ids. La "description" de la entrada de timesheet es texto de Basecamp y NO entra.
alter table horas enable row level security;
create policy horas_select on horas for select to authenticated using (tenant_id = auth_tenant_id());
create index idx_horas_req on horas(requerimiento_id);
create index idx_horas_cliente_fecha on horas(cliente_id, fecha);
create index idx_horas_usuario_fecha on horas(usuario_id, fecha);

create table basecamp_huerfanos (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id),
  cliente_id          uuid not null references clientes(id),
  basecamp_project_id bigint not null,
  basecamp_todolist_id bigint,
  basecamp_todo_id    bigint not null,
  titulo              text not null,          -- excepción D1: título del to-do, interno, nunca visible al cliente
  creador_basecamp_id bigint,
  creador_nombre      text,
  due_on              date,
  completed           boolean not null default false,
  app_url             text,
  detectado_at        timestamptz not null default now(),
  resuelto_at         timestamptz,
  resolucion          text check (resolucion in ('adoptado','ignorado')),
  requerimiento_id    uuid references requerimientos(id),
  unique (tenant_id, basecamp_todo_id)
);
alter table basecamp_huerfanos enable row level security;
create policy huerfanos_select on basecamp_huerfanos for select to authenticated using (tenant_id = auth_tenant_id());
create policy huerfanos_write on basecamp_huerfanos for all to authenticated
  using (tenant_id = auth_tenant_id() and auth_es_gestion()) with check (tenant_id = auth_tenant_id() and auth_es_gestion());
create index idx_huerfanos_pendientes on basecamp_huerfanos(tenant_id) where resuelto_at is null;

alter table proyectos add column if not exists valor_cotizado numeric(12,2);
alter table clientes add column if not exists basecamp_importado_at timestamptz;
