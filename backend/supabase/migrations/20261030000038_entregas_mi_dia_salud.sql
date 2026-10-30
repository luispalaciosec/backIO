-- Migración 38 · 30/10/2026 · mejoras aprobadas por Luis (fases 1 y 2).
--
-- 1. «¿Ya se entregó?»: la fecha en que el responsable dice que entregó una tarea que pasó su fecha y nadie cerró en
--    Basecamp. Para «a tiempo», la entrega real es entregado_el si existe; si no, el día de cierre. La escribe solo el
--    backend (service role), después de validar que quien responde es responsable o de gestión.
-- 2. usuarios.avisos_mi_dia: si la persona recibe el correo «Mi día» (la campana de BackIO lo recibe igual).
-- 3. cliente_salud: foto diaria del color de salud de cada cliente, para avisar cuando cambia y mostrar su evolución.
--    La escribe la tarea programada (service role); la leen los roles de gestión.
-- La vista de métricas expande r.* al crearse: se recrea para que incluya entregado_el (misma definición que la 31).

alter table requerimientos add column if not exists entregado_el date;
alter table requerimientos add column if not exists entregado_por uuid references usuarios(id);
alter table requerimientos add column if not exists entregado_registrado_at timestamptz;

alter table usuarios add column if not exists avisos_mi_dia boolean not null default true;

create table if not exists cliente_salud (
  id         bigint generated always as identity primary key,
  tenant_id  uuid not null references tenants(id),
  cliente_id uuid not null references clientes(id),
  fecha      date not null,
  salud      text not null check (salud in ('verde', 'amarillo', 'rojo')),
  motivos    jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, cliente_id, fecha)
);
create index if not exists cliente_salud_cliente on cliente_salud (tenant_id, cliente_id, fecha desc);
alter table cliente_salud enable row level security;
create policy cliente_salud_select on cliente_salud for select to authenticated
  using (tenant_id = auth_tenant_id() and auth_es_gestion());

drop view if exists v_requerimientos_metricas;
create view v_requerimientos_metricas
with (security_invoker = true) as
select
  r.*,
  case
    when r.estado_operativo in ('completado','cancelado') then 0
    when r.fecha_entrega is null then 0
    else greatest(0, ((now() at time zone 'America/Guayaquil')::date - r.fecha_entrega))
  end as dias_atraso,
  greatest(0, extract(epoch from (now() - r.ultima_actualizacion)) / 86400)::int as dias_sin_movimiento,
  case when r.estado_operativo = 'completado' then r.peso else 0 end as peso_completado
from requerimientos r
where r.deleted_at is null;

-- Verificación: 3 columnas en requerimientos, 1 en usuarios, la tabla con RLS y la vista con entregado_el.
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'requerimientos'
     and column_name in ('entregado_el', 'entregado_por', 'entregado_registrado_at')) as columnas_entrega,      -- 3
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'usuarios'
     and column_name = 'avisos_mi_dia') as columna_avisos,                                                        -- 1
  (select relrowsecurity from pg_class where relname = 'cliente_salud') as cliente_salud_rls,                    -- true
  (select count(*) from information_schema.columns where table_schema = 'public'
     and table_name = 'v_requerimientos_metricas' and column_name = 'entregado_el') as vista_con_entrega;          -- 1
