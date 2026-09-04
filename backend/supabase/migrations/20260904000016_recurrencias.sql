-- D2: recurrencia mensual de fees (04/09/2026). Una recurrencia guarda la configuración del Builder
-- (plantilla, brief, bloques/piezas/owners) y genera el proyecto del mes siguiente el día indicado.
create table if not exists recurrencias (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id),
  cliente_id           uuid not null references clientes(id),
  plantilla_id         uuid not null references plantillas(id),
  nombre_patron        text not null,                 -- "Cronograma de contenido - {mes} {año}"
  brief                jsonb not null default '{}'::jsonb,
  bloques              jsonb not null default '[]'::jsonb,   -- BloqueAlcanceInput[]
  owner_ejecutiva      uuid references usuarios(id),
  dia_generacion       int not null default 25 check (dia_generacion between 1 and 28),
  activa               boolean not null default true,
  ultimo_mes_generado  text,                          -- YYYY-MM del último proyecto creado
  ultimo_proyecto_id   uuid references proyectos(id),
  proyecto_origen_id   uuid references proyectos(id),
  created_by           uuid references usuarios(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, cliente_id, plantilla_id)
);
alter table recurrencias enable row level security;
create policy recurrencias_select on recurrencias for select to authenticated using (tenant_id = auth_tenant_id());
create policy recurrencias_write on recurrencias for all to authenticated
  using (tenant_id = auth_tenant_id() and auth_es_gestion()) with check (tenant_id = auth_tenant_id() and auth_es_gestion());
alter table proyectos add column if not exists recurrencia_id uuid references recurrencias(id);
alter table proyectos add column if not exists periodo text;   -- YYYY-MM cuando el proyecto es de un fee mensual
