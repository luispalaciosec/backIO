-- ============================================================================
-- Migración 33 · Basecamp con la cuenta de cada persona (16/10/2026)
--
-- Basecamp atribuye cada acción al dueño del token. BackIO usaba un solo token para todo el tenant, así que lo que
-- hacía Johanna desde BackIO (crear to-dos, publicar el daily) salía en Basecamp como hecho por quien conectó la
-- integración. Desde ahora cada persona conecta su propia cuenta de Basecamp una vez y lo que hace desde BackIO sale a
-- su nombre. El token del tenant (integracion_credenciales) queda para lo automático, con un usuario «BackIO».
-- Decisiones de Luis (16/10/2026): sin cuenta conectada, BackIO no escribe en Basecamp; lo automático va con «BackIO».
--
-- Zona de revisión humana (credenciales y RLS): no aplicar sin revisión de Luis.
-- ============================================================================

create table if not exists basecamp_credenciales_usuario (
  usuario_id          uuid primary key references usuarios(id) on delete cascade,
  tenant_id           uuid not null references tenants(id) on delete cascade,
  -- Persona de Basecamp dueña del token (authorization.json → identity.id). Tiene que ser la misma persona que
  -- usuarios.basecamp_user_id: nadie puede conectar la cuenta de otro.
  basecamp_person_id  bigint not null,
  -- access_token, refresh_token, expires_at y el correo de Basecamp. Nunca sale del backend.
  datos               jsonb not null,
  conectado_at        timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists basecamp_credenciales_usuario_tenant on basecamp_credenciales_usuario (tenant_id);

-- Como integracion_credenciales: RLS activa y SIN políticas. Ni la persona dueña puede leer su token con su sesión;
-- solo el backend con service role.
alter table basecamp_credenciales_usuario enable row level security;

-- ============================================================================
-- Verificación después de aplicar (solo lectura):
--   select relrowsecurity from pg_class where relname = 'basecamp_credenciales_usuario';            -- true
--   select count(*) from pg_policy where polrelid = 'basecamp_credenciales_usuario'::regclass;      -- 0
--   Con la sesión de un usuario cualquiera (no service role):
--   select count(*) from basecamp_credenciales_usuario;                                              -- 0
-- ============================================================================
