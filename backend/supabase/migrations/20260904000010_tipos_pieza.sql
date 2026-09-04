-- Tipos de pieza: post estático, carrusel, reel. Cada uno con su flujo de pasos (idea → guion → … → posteo).
-- En el Builder se piden cantidades por tipo; BackIO genera un to-do por paso por lote (como hace el equipo hoy).
create table tipos_pieza (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  nombre      text not null,
  slug        text not null,
  esfuerzo    numeric(5,2) not null default 1,     -- peso relativo por unidad (reel 4, post 1)
  pasos       jsonb not null default '[]'::jsonb,   -- [{titulo, rol, dias_offset, peso, visible, etiqueta, aprobacion_cliente}]
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, slug)
);
alter table tipos_pieza enable row level security;
create policy tipos_pieza_select on tipos_pieza for select to authenticated using (tenant_id = auth_tenant_id());
create policy tipos_pieza_write on tipos_pieza for all to authenticated
  using (tenant_id = auth_tenant_id() and auth_es_gestion()) with check (tenant_id = auth_tenant_id() and auth_es_gestion());
create trigger trg_tipos_pieza_updated_at before update on tipos_pieza for each row execute function set_updated_at();

alter table requerimientos add column if not exists tipo_pieza_id uuid references tipos_pieza(id);
alter table mapeo_servicios add column if not exists tipo_pieza_id uuid references tipos_pieza(id);

insert into tipos_pieza (id, tenant_id, nombre, slug, esfuerzo, pasos) values
('50000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Post estático', 'post', 1, '[
  {"titulo":"Copy","rol":"Content","dias_offset":7,"peso":1,"visible":false},
  {"titulo":"Diseño","rol":"Diseñador","dias_offset":5,"peso":2,"visible":false},
  {"titulo":"Revisión de DA","rol":"Director de Arte","dias_offset":4,"peso":0.5,"visible":false},
  {"titulo":"Aprobación cliente","rol":"Ejecutiva de cuenta","dias_offset":2,"peso":0.5,"visible":true,"etiqueta":"Aprobación","aprobacion_cliente":true},
  {"titulo":"Posteo","rol":"Community Manager","dias_offset":0,"peso":1,"visible":true,"etiqueta":"Publicación"}
]'::jsonb),
('50000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'Carrusel', 'carrusel', 1.5, '[
  {"titulo":"Copy","rol":"Content","dias_offset":8,"peso":1,"visible":false},
  {"titulo":"Diseño","rol":"Diseñador","dias_offset":5,"peso":2.5,"visible":false},
  {"titulo":"Revisión de DA","rol":"Director de Arte","dias_offset":4,"peso":0.5,"visible":false},
  {"titulo":"Aprobación cliente","rol":"Ejecutiva de cuenta","dias_offset":2,"peso":0.5,"visible":true,"etiqueta":"Aprobación","aprobacion_cliente":true},
  {"titulo":"Posteo","rol":"Community Manager","dias_offset":0,"peso":1,"visible":true,"etiqueta":"Publicación"}
]'::jsonb),
('50000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'Reel', 'reel', 4, '[
  {"titulo":"Ideas","rol":"Content","dias_offset":18,"peso":1,"visible":false},
  {"titulo":"Guiones","rol":"Content","dias_offset":15,"peso":2,"visible":false},
  {"titulo":"Aprobación de guiones","rol":"Ejecutiva de cuenta","dias_offset":13,"peso":0.5,"visible":true,"etiqueta":"Aprobación de guiones","aprobacion_cliente":true},
  {"titulo":"Storyboards","rol":"Director de Arte","dias_offset":11,"peso":1.5,"visible":false},
  {"titulo":"Grabación","rol":"Audiovisual","dias_offset":7,"peso":3,"visible":false},
  {"titulo":"Edición","rol":"Editor","dias_offset":4,"peso":3,"visible":false},
  {"titulo":"Aprobación cliente","rol":"Ejecutiva de cuenta","dias_offset":2,"peso":0.5,"visible":true,"etiqueta":"Aprobación","aprobacion_cliente":true},
  {"titulo":"Posteo","rol":"Community Manager","dias_offset":0,"peso":1,"visible":true,"etiqueta":"Publicación"}
]'::jsonb)
on conflict (tenant_id, slug) do update set pasos = excluded.pasos, esfuerzo = excluded.esfuerzo;

-- Servicios de PrometIO que son piezas → tipo (se completa cuando exista el catálogo real)
insert into mapeo_servicios (tenant_id, servicio_prometio, tipo_pieza_id) values
  ('00000000-0000-4000-8000-000000000001', 'Reel', '50000000-0000-4000-8000-000000000003'),
  ('00000000-0000-4000-8000-000000000001', 'Post estático', '50000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000001', 'Carrusel', '50000000-0000-4000-8000-000000000002')
on conflict (tenant_id, servicio_prometio) do update set tipo_pieza_id = excluded.tipo_pieza_id;
