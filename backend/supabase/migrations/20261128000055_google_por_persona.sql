-- Migración 55 · 28/11/2026 · Google Calendar de cada persona (reuniones, fase 2; plan aprobado por Luis el 27/11).
-- ZONA DE REVISIÓN (credenciales y RLS).
--
-- Cada persona conecta su Google Calendar una vez («Mi Google Calendar») para que sus reuniones y visitas cuenten como
-- trabajo. Solo lectura de eventos, y de cada evento solo horario, estado y dominios de invitados (regla 1). Igual que
-- basecamp_credenciales_usuario (migración 33): RLS activa y SIN políticas; ni la dueña lee su token con su sesión,
-- solo el backend con service role. Correr completo, una vez.

begin;

create table if not exists public.google_credenciales_usuario (
  usuario_id    uuid primary key references public.usuarios(id) on delete cascade,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  -- Correo de Google que autorizó: tiene que ser el mismo de la persona en BackIO (nadie conecta el calendario de otro).
  email         text not null,
  -- access_token, refresh_token y expires_at. Nunca sale del backend.
  datos         jsonb not null,
  conectado_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists google_credenciales_usuario_tenant on public.google_credenciales_usuario (tenant_id);

alter table public.google_credenciales_usuario enable row level security;

commit;

-- Control: debe dar 3 filas en true.
select 'tabla' as control, exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'google_credenciales_usuario') as ok
union all select 'RLS activa', (select relrowsecurity from pg_class where oid = 'public.google_credenciales_usuario'::regclass)
union all select 'sin políticas', (select count(*) = 0 from pg_policies where schemaname = 'public' and tablename = 'google_credenciales_usuario');
