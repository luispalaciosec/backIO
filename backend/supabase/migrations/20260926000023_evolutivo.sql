-- Evolutivo de rituales (26/09/2026): foto diaria y semanal por mesa para medir la evolución del mes.
-- ZONA DE REVISIÓN HUMANA (CLAUDE.md): crea políticas RLS. Idempotente.
-- Antes, las métricas del cierre del daily se calculaban, iban a Basecamp y se perdían.

create table if not exists daily_snapshots (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  mesa_id      uuid not null references mesas(id) on delete cascade,
  fecha        date not null,
  metricas     jsonb not null,           -- mismas métricas que el cierre del daily (DailyKpis) + abiertas_seleccion
  seleccion    uuid[] not null default '{}',  -- tareas marcadas para el daily ese día
  por_persona  jsonb not null default '[]',
  origen       text not null check (origen in ('cierre','cron','reconstruido')),
  publicado    boolean not null default false,  -- hubo cierre publicado en Basecamp ese día
  apertura_publicada boolean not null default false,
  message_id   bigint,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, mesa_id, fecha)
);
create index if not exists daily_snapshots_mes on daily_snapshots (tenant_id, mesa_id, fecha desc);
create trigger trg_daily_snapshots_updated_at before update on daily_snapshots for each row execute function set_updated_at();

create table if not exists weekly_snapshots (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  mesa_id       uuid not null references mesas(id) on delete cascade,
  semana_id     uuid not null references semanas(id) on delete cascade,
  fecha_inicio  date not null,
  fecha_fin     date not null,
  metricas      jsonb not null,
  origen        text not null check (origen in ('cron','reconstruido','manual')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, mesa_id, semana_id)
);
create index if not exists weekly_snapshots_fecha on weekly_snapshots (tenant_id, mesa_id, fecha_inicio desc);
create trigger trg_weekly_snapshots_updated_at before update on weekly_snapshots for each row execute function set_updated_at();

-- Lectura para gestión del tenant; escritura solo por el backend (service role).
alter table daily_snapshots enable row level security;
alter table weekly_snapshots enable row level security;
create policy daily_snapshots_select on daily_snapshots for select to authenticated using (tenant_id = auth_tenant_id() and auth_es_gestion());
create policy weekly_snapshots_select on weekly_snapshots for select to authenticated using (tenant_id = auth_tenant_id() and auth_es_gestion());
