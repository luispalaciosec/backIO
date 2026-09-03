-- ============================================================================
-- Fase 0 · API keys con scopes, auditoría, planes de agente (preview + confirm)
-- Estas tablas SOLO las toca el backend con service role. Sin políticas para
-- authenticated: RLS on = deny-all desde el cliente.
-- ============================================================================

create table api_keys (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  nombre        text not null,
  prefijo       text not null,                 -- primeros 8 chars visibles ("bk_live_ab12…")
  key_hash      text not null unique,          -- sha256 de la key completa
  scopes        text[] not null default '{}',  -- read:backlog, write:requerimientos, admin…
  perfil        text,                          -- gerencial | ejecutiva | operaciones | prometio
  creado_por    uuid references usuarios(id),
  ultimo_uso_at timestamptz,
  revocada_at   timestamptz,
  created_at    timestamptz not null default now()
);
alter table api_keys enable row level security;
create policy api_keys_select_admin on api_keys
  for select to authenticated using (tenant_id = auth_tenant_id() and auth_es_admin());

create table audit_log (
  id          bigserial primary key,
  tenant_id   uuid not null references tenants(id),
  sistema     text not null default 'backio',
  usuario_id  uuid references usuarios(id),
  api_key_id  uuid references api_keys(id),
  origen      text not null,                  -- ui | api | mcp | webhook:basecamp | webhook:prometio | cron
  accion      text not null,
  entidad     text not null,
  entidad_id  uuid,
  detalle     jsonb,
  created_at  timestamptz not null default now()
);
alter table audit_log enable row level security;
create policy audit_log_select_admin on audit_log
  for select to authenticated using (tenant_id = auth_tenant_id() and auth_es_admin());
create index idx_audit_tenant_fecha on audit_log(tenant_id, created_at desc);

-- Planes generados por tools MCP de escritura. Expiran en 15 min, un solo uso.
create table agent_plans (
  id           text primary key,             -- plan_xxxxxxxx
  tenant_id    uuid not null references tenants(id),
  api_key_id   uuid references api_keys(id),
  tool         text not null,
  parametros   jsonb not null,
  plan         jsonb not null,               -- preview devuelto al agente
  expira_at    timestamptz not null,
  ejecutado_at timestamptz,
  resultado    jsonb,
  created_at   timestamptz not null default now()
);
alter table agent_plans enable row level security;

-- Cache del resumen ejecutivo IA del portal (6 horas)
create table portal_resumenes (
  proyecto_id   uuid primary key references proyectos(id) on delete cascade,
  tenant_id     uuid not null references tenants(id),
  payload_hash  text not null,
  resumen       text not null,
  generado_at   timestamptz not null default now()
);
alter table portal_resumenes enable row level security;

-- Notificaciones (canal por decidir: correo vs Slack). Se encolan aquí.
create table notificaciones (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  usuario_id   uuid references usuarios(id),
  canal        text not null default 'pendiente',   -- email | slack | pendiente
  tipo         text not null,
  titulo       text not null,
  cuerpo       text,
  entidad_tipo text,
  entidad_id   uuid,
  enviada_at   timestamptz,
  leida_at     timestamptz,
  created_at   timestamptz not null default now()
);
alter table notificaciones enable row level security;
create policy notificaciones_select_propias on notificaciones
  for select to authenticated using (tenant_id = auth_tenant_id() and usuario_id = auth.uid());
create policy notificaciones_update_propias on notificaciones
  for update to authenticated using (tenant_id = auth_tenant_id() and usuario_id = auth.uid());
