-- Migración 40 · 30/10/2026 · informes para el cliente (docs/21).
--
-- La ejecutiva genera desde la ficha del cliente un informe semanal o mensual que la IA redacta SOLO con datos aptos
-- para el cliente (sanitizeForClient + assertClientSafe, el mismo camino que el resumen del portal). Lo edita, lo copia
-- o lo imprime y lo envía desde su correo. Aquí queda el historial: qué se generó, con qué datos, quién lo editó.
-- No se publica en el portal.
--
-- RLS: lo leen, crean y editan los roles de gestión del mismo tenant (auth_es_gestion: admin, gerencia, operaciones,
-- ejecutiva, líder). Un colaborador no lo ve. No hay borrado: es historial.

create table if not exists informes_cliente (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  cliente_id    uuid not null references clientes(id),
  periodo       text not null check (periodo in ('semanal', 'mensual')),
  desde         date not null,
  hasta         date not null,
  asunto        text not null,
  cuerpo        text not null,
  -- Datos que recibió la IA: solo campos aptos para el cliente (etiquetas, avance, fechas).
  datos         jsonb not null default '{}'::jsonb,
  generado_por  uuid references usuarios(id),
  editado_por   uuid references usuarios(id),
  editado_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (desde <= hasta)
);
create index if not exists informes_cliente_cliente on informes_cliente (tenant_id, cliente_id, created_at desc);
create trigger trg_informes_cliente_updated_at before update on informes_cliente for each row execute function set_updated_at();

alter table informes_cliente enable row level security;
create policy informes_cliente_select on informes_cliente for select to authenticated
  using (tenant_id = auth_tenant_id() and auth_es_gestion());
create policy informes_cliente_insert on informes_cliente for insert to authenticated
  with check (tenant_id = auth_tenant_id() and auth_es_gestion());
create policy informes_cliente_update on informes_cliente for update to authenticated
  using (tenant_id = auth_tenant_id() and auth_es_gestion())
  with check (tenant_id = auth_tenant_id() and auth_es_gestion());

-- Verificación: la tabla con RLS y sus 3 políticas (esperado: true, 3).
select
  (select relrowsecurity from pg_class where relname = 'informes_cliente') as informes_rls,         -- true
  (select count(*) from pg_policies where tablename = 'informes_cliente') as politicas;           -- 3
