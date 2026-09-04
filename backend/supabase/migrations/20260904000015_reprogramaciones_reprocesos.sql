-- Cumplimiento: trazabilidad de reprogramaciones y reprocesos (aprobado por Luis 04/09/2026).
-- Se registra motivo de catálogo y paso; NUNCA texto de comentarios (regla 1).

create table if not exists reprogramaciones (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  requerimiento_id uuid not null references requerimientos(id),
  fecha_anterior   date,
  fecha_nueva      date,
  motivo           text check (motivo in ('insumos_cliente','cambio_alcance','capacidad_equipo','prioridad_negocio','error_estimacion','reproceso','otro')),
  origen           text not null default 'desconocido',   -- ui | api | mcp | desconocido
  usuario_id       uuid references usuarios(id),
  created_at       timestamptz not null default now()
);
create index if not exists reprogramaciones_req on reprogramaciones (tenant_id, requerimiento_id, created_at desc);
create index if not exists reprogramaciones_sin_motivo on reprogramaciones (tenant_id, created_at desc) where motivo is null;

create table if not exists reprocesos (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id),
  requerimiento_id    uuid not null references requerimientos(id),
  origen              text not null check (origen in ('cliente','interno','basecamp')),
  motivo              text check (motivo in ('brief_incompleto','error_ejecucion','cambio_opinion_cliente','ajuste_marca_legal','direccion_arte','error_texto')),
  paso_retorno        text,
  fecha_entrega_antes date,
  abierto_at          timestamptz not null default now(),
  cerrado_at          timestamptz,
  horas_reproceso     numeric(8,2),
  usuario_id          uuid references usuarios(id),
  created_at          timestamptz not null default now()
);
create index if not exists reprocesos_req on reprocesos (tenant_id, requerimiento_id, abierto_at desc);
create index if not exists reprocesos_abiertos on reprocesos (tenant_id, abierto_at desc) where cerrado_at is null;

alter table requerimientos add column if not exists veces_reproceso int not null default 0;

-- RLS: lectura de todo el tenant; escritura para gestión y para el responsable de la tarea (el backend acota campos).
alter table reprogramaciones enable row level security;
create policy reprogramaciones_select on reprogramaciones for select to authenticated using (tenant_id = auth_tenant_id());
create policy reprogramaciones_insert on reprogramaciones for insert to authenticated with check (tenant_id = auth_tenant_id());
create policy reprogramaciones_update on reprogramaciones for update to authenticated using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
alter table reprocesos enable row level security;
create policy reprocesos_select on reprocesos for select to authenticated using (tenant_id = auth_tenant_id());
create policy reprocesos_insert on reprocesos for insert to authenticated with check (tenant_id = auth_tenant_id());
create policy reprocesos_update on reprocesos for update to authenticated using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());

-- Cada cambio de fecha_entrega deja fila en reprogramaciones (el backend completa motivo y origen).
create or replace function requerimientos_after_update_reprogramacion() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.fecha_entrega is distinct from old.fecha_entrega and old.fecha_entrega is not null then
    insert into reprogramaciones (tenant_id, requerimiento_id, fecha_anterior, fecha_nueva, usuario_id, origen)
    values (new.tenant_id, new.id, old.fecha_entrega, new.fecha_entrega, new.updated_by, 'desconocido');
  end if;
  return new;
end $$;
drop trigger if exists trg_requerimientos_after_update_reprogramacion on requerimientos;
create trigger trg_requerimientos_after_update_reprogramacion
  after update on requerimientos for each row execute function requerimientos_after_update_reprogramacion();

-- La vista expande r.* al crearse: hay que recrearla para que incluya veces_reproceso (sin dependientes).
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
