-- OAuth 2.1 para clientes MCP (Claude, ChatGPT…): registro dinámico, códigos con PKCE, tokens opacos.
create table oauth_clients (
  id             text primary key,             -- client_id
  secret_hash    text,                         -- null → cliente público (PKCE)
  nombre         text not null,
  redirect_uris  text[] not null,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
alter table oauth_clients enable row level security;

create table oauth_codes (
  code            text primary key,
  client_id       text not null references oauth_clients(id),
  redirect_uri    text not null,
  code_challenge  text not null,
  scope           text not null default '',
  tenant_id       uuid not null references tenants(id),
  usuario_id      uuid not null references usuarios(id),
  expira_at       timestamptz not null,
  usado_at        timestamptz,
  created_at      timestamptz not null default now()
);
alter table oauth_codes enable row level security;

create table oauth_tokens (
  token_hash      text primary key,
  tipo            text not null check (tipo in ('access','refresh')),
  client_id       text not null references oauth_clients(id),
  tenant_id       uuid not null references tenants(id),
  usuario_id      uuid not null references usuarios(id),
  scope           text not null default '',
  expira_at       timestamptz not null,
  revocado_at     timestamptz,
  created_at      timestamptz not null default now()
);
alter table oauth_tokens enable row level security;
create index idx_oauth_tokens_usuario on oauth_tokens(usuario_id, tipo);
