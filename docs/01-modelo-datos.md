# 01 · Modelo de datos

## Principios

1. `tenant_id UUID NOT NULL` en toda tabla de negocio. RLS activa en todas.
2. `cliente_id` es la clave compartida con PrometIO. Mismo valor en ambos sistemas.
3. Soft delete (`deleted_at`) en entidades de negocio. Nunca `DELETE` físico.
4. Auditoría: `created_at`, `updated_at`, `created_by`, `updated_by` en todas.

---

## Esquema

```sql
-- ============================================================
-- TENANT Y CLIENTES
-- ============================================================

create table tenants (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  slug          text not null unique,
  config        jsonb not null default '{}'::jsonb,  -- logo, colores, timezone
  activo        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table clientes (
  id                  uuid primary key,  -- MISMO ID QUE PROMETIO. No autogenerar.
  tenant_id           uuid not null references tenants(id),
  nombre              text not null,
  slug                text not null,
  logo_url            text,
  color_primario      text default '#0073EA',
  basecamp_project_id bigint,            -- proyecto raíz en Basecamp
  activo              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  unique (tenant_id, slug)
);

-- ============================================================
-- PLANTILLAS  (aquí se define visibilidad y peso, UNA sola vez)
-- ============================================================

create table plantillas (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  nombre        text not null,           -- "Campaña 360", "Lanzamiento de producto"
  descripcion   text,
  tipo          text not null,           -- campana | lanzamiento | fee_mensual | pieza_suelta
  activa        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table plantilla_bloques (
  id            uuid primary key default gen_random_uuid(),
  plantilla_id  uuid not null references plantillas(id) on delete cascade,
  nombre        text not null,           -- "Investigación", "Producción"
  peso          numeric(5,2) not null,   -- % del proyecto. Suma por plantilla = 100
  orden         int not null,
  opcional      boolean not null default false,  -- se puede desmarcar en paso 3
  constraint peso_valido check (peso > 0 and peso <= 100)
);

create table plantilla_tareas (
  id                        uuid primary key default gen_random_uuid(),
  bloque_id                 uuid not null references plantilla_bloques(id) on delete cascade,
  titulo_interno            text not null,   -- "Ruta creativa v1"
  etiqueta_cliente          text,            -- "Propuesta creativa" | null si no visible
  visible_cliente_default   boolean not null default false,
  peso_relativo             numeric(5,2) not null default 1,  -- dentro del bloque
  dias_offset               int not null default 0,  -- desde inicio del bloque
  rol_sugerido              text,            -- "Director de Arte", "Content"
  orden                     int not null,
  constraint etiqueta_requerida
    check (visible_cliente_default = false or etiqueta_cliente is not null)
);

-- ============================================================
-- PROYECTOS Y REQUERIMIENTOS
-- ============================================================

create type estado_operativo as enum (
  'backlog', 'priorizado', 'en_ejecucion', 'en_revision',
  'reprogramado', 'bloqueado', 'completado', 'cancelado'
);

create type estado_aprobacion as enum (
  'no_aplica', 'pendiente_interno', 'pendiente_cliente',
  'aprobado', 'rechazado'
);

create type prioridad_t as enum ('alta', 'media', 'baja');

create table proyectos (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),
  cliente_id            uuid not null references clientes(id),
  plantilla_id          uuid references plantillas(id),
  prometio_cotizacion_id uuid,            -- origen comercial, nullable
  nombre                text not null,
  brief                 jsonb not null default '{}'::jsonb,
  fecha_inicio          date not null,
  fecha_entrega         date not null,
  owner_ejecutiva       uuid references usuarios(id),
  estado                estado_operativo not null default 'priorizado',
  basecamp_todoset_id   bigint,
  portal_token          text unique,       -- token firmado para acceso cliente
  portal_activo         boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);

create table requerimientos (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),
  cliente_id            uuid not null references clientes(id),
  proyecto_id           uuid references proyectos(id) on delete cascade,
  bloque_nombre         text,              -- denormalizado desde plantilla
  plantilla_tarea_id    uuid references plantilla_tareas(id),

  titulo_interno        text not null,
  etiqueta_cliente      text,
  visible_cliente       boolean not null default false,

  tipo_trabajo          text not null default 'fee',   -- fee | proyecto
  estado_operativo      estado_operativo not null default 'backlog',
  estado_aprobacion     estado_aprobacion not null default 'no_aplica',
  prioridad             prioridad_t not null default 'media',

  peso                  numeric(6,3) not null default 1,   -- peso absoluto en el proyecto

  fecha_pedido          date,
  fecha_entrega         date,
  fecha_entrega_original date,             -- para medir arrastre
  veces_reprogramado    int not null default 0,

  owner_agencia         uuid[] not null default '{}',
  owner_cliente         text[],            -- nombres, no usuarios del sistema
  piezas                int not null default 0,

  brief_url             text,
  entregable_urls       text[],

  basecamp_todo_id      bigint,
  basecamp_todolist_id  bigint,
  basecamp_url          text,

  ultima_actualizacion  timestamptz not null default now(),
  completado_at         timestamptz,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references usuarios(id),
  deleted_at            timestamptz,

  constraint etiqueta_si_visible
    check (visible_cliente = false or etiqueta_cliente is not null)
);

-- Nota comment (canal de cuenta, NO de producción)
create table notas_cuenta (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  requerimiento_id  uuid not null references requerimientos(id) on delete cascade,
  autor_id          uuid not null references usuarios(id),
  cuerpo            text not null,
  visible_cliente   boolean not null default false,
  created_at        timestamptz not null default now()
);
-- IMPORTANTE: esta tabla es SOLO para notas de ejecutiva/líder.
-- Los comentarios de producción viven en Basecamp y NO se replican aquí.
-- Ver 02-visibilidad.md

-- ============================================================
-- USUARIOS Y ROLES
-- ============================================================

create type rol_t as enum (
  'admin', 'gerencia', 'operaciones', 'ejecutiva', 'lider', 'colaborador'
);

create table usuarios (
  id                uuid primary key references auth.users(id),
  tenant_id         uuid not null references tenants(id),
  nombre            text not null,
  email             text not null,
  rol               rol_t not null default 'colaborador',
  avatar_url        text,
  basecamp_user_id  bigint,
  capacidad_semanal int not null default 40,   -- horas
  activo            boolean not null default true
);

-- ============================================================
-- RITUALES
-- ============================================================

create table semanas (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  anio              int not null,
  numero_iso        int not null,
  fecha_inicio      date not null,
  fecha_fin         date not null,
  plan_publicado_at timestamptz,
  acta_publicada_at timestamptz,
  unique (tenant_id, anio, numero_iso)
);

create table senales (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  semana_id         uuid not null references semanas(id),
  tipo              text not null,     -- ver 05-rituales.md
  severidad         text not null,     -- critica | alta | media
  entidad_tipo      text not null,     -- requerimiento | usuario | cliente | proyecto
  entidad_id        uuid not null,
  titulo            text not null,
  detalle           jsonb not null default '{}'::jsonb,
  atendida          boolean not null default false,
  created_at        timestamptz not null default now()
);

create table acuerdos (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  semana_id         uuid not null references semanas(id),
  descripcion       text not null,
  responsable_id    uuid not null references usuarios(id),
  fecha_compromiso  date not null,     -- FECHA REAL. Ver validación abajo.
  estado            text not null default 'pendiente',
  cerrado_at        timestamptz,
  created_at        timestamptz not null default now()
);

create table actas (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  semana_id         uuid not null references semanas(id),
  tipo              text not null,     -- plan_operativo | cierre
  contenido         jsonb not null,    -- snapshot estructurado
  markdown          text not null,     -- render listo para Basecamp
  publicado_at      timestamptz,
  publicado_por     uuid references usuarios(id)
);
```

---

## Campos calculados (vistas materializadas o generated columns)

```sql
create view v_requerimientos_metricas as
select
  r.*,
  case
    when r.estado_operativo in ('completado','cancelado') then 0
    when r.fecha_entrega is null then 0
    else greatest(0, (current_date - r.fecha_entrega))
  end as dias_atraso,
  extract(day from (now() - r.ultima_actualizacion))::int as dias_sin_movimiento,
  case when r.estado_operativo = 'completado' then r.peso else 0 end as peso_completado
from requerimientos r
where r.deleted_at is null;
```

**`dias_sin_movimiento` es el campo más importante del sistema.** Es el que detecta un
tablero muerto antes de que sea un problema de cuenta. Monday lo tenía disponible y nadie
lo miraba; en BackIO dispara alerta, no columna.

---

## Validación crítica: fechas de compromiso

En las actas actuales de Geeks, siete pendientes se registraron con fecha "Próxima Weekly".
Eso no es una fecha, es un aplazamiento disfrazado.

```sql
alter table acuerdos
  add constraint fecha_real check (fecha_compromiso > created_at::date);
```

La UI **no** ofrece opción "próxima weekly". Solo date picker. Si el responsable no sabe
la fecha, el acuerdo no se puede guardar — que es exactamente la fricción que se busca.

---

## RLS

```sql
alter table clientes         enable row level security;
alter table proyectos        enable row level security;
alter table requerimientos   enable row level security;
alter table notas_cuenta     enable row level security;
alter table senales          enable row level security;
alter table acuerdos         enable row level security;
alter table actas            enable row level security;

-- Función helper
create or replace function auth_tenant_id() returns uuid as $$
  select tenant_id from usuarios where id = auth.uid()
$$ language sql stable security definer;

-- Política base (repetir por tabla)
create policy tenant_isolation on requerimientos
  for all using (tenant_id = auth_tenant_id());

-- Colaboradores solo ven lo asignado a ellos o de su cliente
create policy colaborador_scope on requerimientos
  for select using (
    tenant_id = auth_tenant_id()
    and (
      (select rol from usuarios where id = auth.uid())
        in ('admin','gerencia','operaciones','ejecutiva','lider')
      or auth.uid() = any(owner_agencia)
    )
  );
```

**Verificación obligatoria antes de cerrar Fase 0:** crear un tenant de prueba con un
usuario, e intentar leer datos del tenant de Geeks. Debe devolver cero filas.

---

## Índices

```sql
create index idx_req_cliente_estado   on requerimientos(cliente_id, estado_operativo)
                                       where deleted_at is null;
create index idx_req_fecha_entrega    on requerimientos(fecha_entrega)
                                       where deleted_at is null;
create index idx_req_owner            on requerimientos using gin(owner_agencia);
create index idx_req_ultima_act       on requerimientos(ultima_actualizacion);
create index idx_req_basecamp         on requerimientos(basecamp_todo_id);
create index idx_senales_semana       on senales(semana_id, atendida);
```
