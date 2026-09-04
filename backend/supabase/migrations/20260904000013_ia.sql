-- Capa de IA (Sprint 4): caché/auditoría de generaciones e informes mensuales.
-- La IA recibe ÚNICAMENTE datos estructurados de BackIO (títulos, estados, fechas, números).
-- Nunca texto de Basecamp. Cada generación queda registrada con el hash del payload.
create table if not exists ia_generaciones (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  tipo           text not null,            -- daily | weekly | brief | recordatorio | informe_mensual
  entidad_tipo   text,
  entidad_id     text,
  payload_hash   text not null,
  texto          text not null,
  datos          jsonb,
  modelo         text not null,
  tokens_entrada int,
  tokens_salida  int,
  creado_por     uuid references usuarios(id),
  created_at     timestamptz not null default now()
);
create index if not exists ia_generaciones_cache on ia_generaciones (tenant_id, tipo, payload_hash, created_at desc);
alter table ia_generaciones enable row level security;
create policy ia_generaciones_select on ia_generaciones for select to authenticated using (tenant_id = auth_tenant_id());

-- Informe mensual ejecutivo por mesa se guarda como acta.
alter table actas drop constraint if exists actas_tipo_check;
alter table actas add constraint actas_tipo_check check (tipo in ('plan_operativo','cierre','informe_mensual'));
