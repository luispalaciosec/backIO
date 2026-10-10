-- Auditoría externa del 10/10/2026 · Ola 1b: los hallazgos de seguridad que se corrigen en la base.
-- ZONA DE REVISIÓN HUMANA (CLAUDE.md): cambia políticas RLS y crea tablas sin políticas. Idempotente.
-- Todo con esquema explícito (public.): el editor SQL de Supabase no siempre tiene public en el search_path.
--
--  S2  · clientes y mesas: por PostgREST cualquier rol de gestión podía escribir lo que la API reserva a admin
--        (config y PIN del cliente, proyecto de Basecamp, boards de las mesas → el daily/weekly se publicaba donde
--        apuntara). Ahora escribir en esas tablas con sesión de usuario exige admin, igual que la API.
--        El backend escribe con service role donde lo necesita (importación de Basecamp, PrometIO).
--  S9  · agent_plans.usuario_id: un plan del MCP solo lo confirma quien lo generó (persona o API key).
--  S11 · api_keys.cliente_id: una key de perfil «cliente» queda atada a un cliente.
--  M3  · portal_pines: el PIN del portal se guarda con hash (scrypt + sal) en una tabla solo para service role,
--        ya no en claro dentro de clientes.config (legible por todo el tenant).

-- ============================================================================
-- S2 · Escritura de clientes y mesas solo para admin
-- ============================================================================
drop policy if exists clientes_write on public.clientes;
create policy clientes_write on public.clientes
  for all to authenticated
  using (tenant_id = public.auth_tenant_id() and public.auth_es_admin())
  with check (tenant_id = public.auth_tenant_id() and public.auth_es_admin());

drop policy if exists mesas_write on public.mesas;
create policy mesas_write on public.mesas
  for all to authenticated
  using (tenant_id = public.auth_tenant_id() and public.auth_es_admin())
  with check (tenant_id = public.auth_tenant_id() and public.auth_es_admin());

-- ============================================================================
-- S9 · Planes del MCP atados a quien los creó
-- ============================================================================
alter table public.agent_plans add column if not exists usuario_id uuid references public.usuarios(id);

-- ============================================================================
-- S11 · API keys de perfil cliente atadas a un cliente
-- ============================================================================
alter table public.api_keys add column if not exists cliente_id uuid references public.clientes(id);
-- Las keys «cliente» que ya existan quedan sin cliente: el backend las rechaza hasta que un admin cree una nueva
-- con cliente (se revisa con la consulta del final).

-- ============================================================================
-- M3 · PIN del portal con hash, fuera de clientes.config
-- ============================================================================
create table if not exists public.portal_pines (
  cliente_id  uuid primary key references public.clientes(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id),
  hash        text not null,                 -- scrypt$N$r$p$sal$derivado (lo calcula el backend)
  updated_at  timestamptz not null default now()
);
alter table public.portal_pines enable row level security;
-- Sin políticas: solo el service role (backend) lee y escribe. Ningún usuario ve el hash.

-- ============================================================================
-- Verificación después de aplicar (solo lectura; 5 filas en true):
--   select 'clientes_write solo admin' as control, pg_get_expr(polqual, polrelid) like '%auth_es_admin%' as ok from pg_policy where polname = 'clientes_write'
--   union all select 'mesas_write solo admin', pg_get_expr(polqual, polrelid) like '%auth_es_admin%' from pg_policy where polname = 'mesas_write'
--   union all select 'agent_plans.usuario_id', count(*) = 1 from information_schema.columns where table_name = 'agent_plans' and column_name = 'usuario_id'
--   union all select 'api_keys.cliente_id', count(*) = 1 from information_schema.columns where table_name = 'api_keys' and column_name = 'cliente_id'
--   union all select 'portal_pines con RLS y sin políticas', (select relrowsecurity from pg_class where relname = 'portal_pines') and not exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname = 'portal_pines');
-- Keys de perfil cliente activas que habrá que recrear con cliente:
--   select id, nombre, created_at from public.api_keys where perfil = 'cliente' and revocada_at is null;
-- ============================================================================
