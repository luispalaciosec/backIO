-- ============================================================================
-- Invitaciones: pre-registro de email + rol. Al crearse el usuario en auth.users
-- (dashboard, invite o signup), un trigger crea su fila en usuarios automáticamente.
-- Sin invitación, un email @geeks.com.ec entra como colaborador del tenant Geeks.
-- Cualquier otro dominio NO recibe fila en usuarios (queda sin acceso).
-- ============================================================================

create table invitaciones (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  email       text not null,
  nombre      text not null,
  rol         rol_t not null default 'colaborador',
  capacidad_semanal int not null default 40,
  usada_at    timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid references usuarios(id),
  unique (tenant_id, email)
);
alter table invitaciones enable row level security;
create policy invitaciones_admin on invitaciones
  for all to authenticated
  using (tenant_id = auth_tenant_id() and auth_es_admin())
  with check (tenant_id = auth_tenant_id() and auth_es_admin());

-- Dominios de correo que entran automáticamente como colaborador, por tenant.
alter table tenants add column if not exists dominios_auto text[] not null default '{}';
update tenants set dominios_auto = array['geeks.com.ec', 'geeks.ec'] where slug = 'geeks';

create or replace function handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(new.email);
  v_inv   invitaciones%rowtype;
  v_tenant uuid;
  v_nombre text;
begin
  if v_email is null then return new; end if;

  select * into v_inv from invitaciones where lower(email) = v_email and usada_at is null limit 1;

  if found then
    insert into usuarios (id, tenant_id, nombre, email, rol, capacidad_semanal)
    values (new.id, v_inv.tenant_id, v_inv.nombre, v_email, v_inv.rol, v_inv.capacidad_semanal)
    on conflict (id) do nothing;
    update invitaciones set usada_at = now() where id = v_inv.id;
    return new;
  end if;

  select id into v_tenant from tenants
  where activo and split_part(v_email, '@', 2) = any(dominios_auto)
  limit 1;

  if v_tenant is not null then
    v_nombre := coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', initcap(replace(split_part(v_email, '@', 1), '.', ' ')));
    insert into usuarios (id, tenant_id, nombre, email, rol)
    values (new.id, v_tenant, v_nombre, v_email, 'colaborador')
    on conflict (id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- Marcia: product owner, rol operaciones.
insert into invitaciones (tenant_id, email, nombre, rol)
values ('00000000-0000-4000-8000-000000000001', 'operaciones@geeks.com.ec', 'Marcia', 'operaciones')
on conflict (tenant_id, email) do update set rol = excluded.rol, nombre = excluded.nombre;
