-- Bitácora por tarea (23/09/2026): observaciones fechadas con el estado del momento. Reemplaza el Excel
-- "Control de tareas" que las ejecutivas llevaban con el cliente. Texto escrito en BackIO (no viene de Basecamp).
create table if not exists bitacora (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  requerimiento_id  uuid not null references requerimientos(id) on delete cascade,
  usuario_id        uuid references usuarios(id),
  nota              text not null check (length(nota) between 1 and 2000),
  estado_operativo  text,
  estado_aprobacion text,
  -- Solo se muestra al cliente si la tarea es visible_cliente Y la nota se marcó visible (regla 2: nunca abre lo oculto).
  visible_cliente   boolean not null default false,
  created_at        timestamptz not null default now()
);
create index if not exists bitacora_req on bitacora (tenant_id, requerimiento_id, created_at desc);
create index if not exists bitacora_tenant_fecha on bitacora (tenant_id, created_at desc);

alter table bitacora enable row level security;
create policy bitacora_select on bitacora for select to authenticated using (tenant_id = auth_tenant_id());
create policy bitacora_insert on bitacora for insert to authenticated with check (tenant_id = auth_tenant_id());
create policy bitacora_update on bitacora for update to authenticated using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy bitacora_delete on bitacora for delete to authenticated using (tenant_id = auth_tenant_id());
