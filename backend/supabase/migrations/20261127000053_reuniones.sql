-- Migración 53 · 27/11/2026 · reuniones y visitas cuentan como trabajo (plan aprobado por Luis). ZONA DE REVISIÓN (RLS).
--
-- Las reuniones salen de los eventos de Basecamp (schedule de cada proyecto) y, en la fase 2, del Google Calendar que cada
-- persona conecte. Regla 1: de un evento solo entran horario, estado y los DOMINIOS de los invitados externos (para saber
-- el cliente). Nunca título, descripción, notas ni correos.
-- Correr completo, una vez.

begin;

create table if not exists public.reuniones (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id),
  usuario_id        uuid not null references public.usuarios(id),
  origen            text not null check (origen in ('basecamp', 'google')),
  externo_id        text not null,                       -- id del evento (con la fecha si es una repetición)
  inicio            timestamptz not null,
  fin               timestamptz not null check (fin > inicio),
  fecha             date not null,                       -- día del inicio en America/Guayaquil
  horas             numeric(5,2) not null check (horas > 0),
  cliente_id        uuid references public.clientes(id),
  asignacion        text check (asignacion in ('proyecto', 'dominio', 'manual')),
  dominios_externos text[] not null default '{}',
  respuesta         text not null default 'aceptada' check (respuesta in ('aceptada', 'tentativa', 'sin_respuesta')),
  cancelada         boolean not null default false,
  sincronizado_at   timestamptz not null default now(),
  unique (tenant_id, usuario_id, origen, externo_id)
);
create index if not exists reuniones_persona_fecha on public.reuniones (tenant_id, usuario_id, fecha) where not cancelada;
create index if not exists reuniones_fecha on public.reuniones (tenant_id, fecha) where not cancelada;
create index if not exists reuniones_cliente on public.reuniones (tenant_id, cliente_id, fecha) where not cancelada;

alter table public.reuniones enable row level security;

-- Gestión ve las del tenant; cada persona ve las suyas. Solo gestión corrige el cliente (asignación manual).
-- Insertar y borrar: solo el backend (service role), por eso no hay políticas de insert ni delete.
create policy reuniones_select on public.reuniones for select to authenticated
  using (tenant_id = (select auth_tenant_id()) and ((select auth_es_gestion()) or usuario_id = (select auth.uid())));
create policy reuniones_update on public.reuniones for update to authenticated
  using (tenant_id = (select auth_tenant_id()) and (select auth_es_gestion()))
  with check (tenant_id = (select auth_tenant_id()) and (select auth_es_gestion()));

-- Dominios de correo de cada cliente (p. ej. bancoamazonas.com): un invitado con ese dominio asigna la reunión al cliente.
alter table public.clientes add column if not exists dominios_correo text[] not null default '{}';

commit;

-- Control: debe dar 4 filas en true.
select 'tabla reuniones' as control, exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'reuniones') as ok
union all select 'RLS activa', (select relrowsecurity from pg_class where oid = 'public.reuniones'::regclass)
union all select '2 políticas', (select count(*) = 2 from pg_policies where schemaname = 'public' and tablename = 'reuniones')
union all select 'clientes.dominios_correo', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clientes' and column_name = 'dominios_correo');
