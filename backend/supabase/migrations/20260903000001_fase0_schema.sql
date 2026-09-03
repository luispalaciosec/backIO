-- ============================================================================
-- Fase 0 · Esquema base de BackIO
-- Principios (docs/01-modelo-datos.md):
--   1. tenant_id NOT NULL en toda tabla de negocio. RLS activa en todas.
--   2. clientes.id es el MISMO uuid que PrometIO. No autogenerar.
--   3. Soft delete (deleted_at). Nunca DELETE físico.
--   4. Auditoría created_at/updated_at/created_by/updated_by.
-- Esta migración crea tablas y ENCIENDE RLS sin políticas (deny-all).
-- Las políticas viven en 20260903000002_fase0_rls.sql (zona de revisión humana).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- enums
create type estado_operativo as enum (
  'backlog', 'priorizado', 'en_ejecucion', 'en_revision',
  'reprogramado', 'bloqueado', 'completado', 'cancelado'
);

create type estado_aprobacion as enum (
  'no_aplica', 'pendiente_interno', 'pendiente_cliente', 'aprobado', 'rechazado'
);

create type prioridad_t as enum ('alta', 'media', 'baja');

create type rol_t as enum (
  'admin', 'gerencia', 'operaciones', 'ejecutiva', 'lider', 'colaborador'
);

create type tipo_plantilla_t as enum (
  'campana', 'lanzamiento', 'fee_mensual', 'pieza_suelta', 'trade'
);

create type sync_estado_t as enum ('pendiente', 'ok', 'incompleto');

-- ---------------------------------------------------------------- tenants
create table tenants (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  slug          text not null unique,
  config        jsonb not null default '{}'::jsonb,  -- logo, colores, timezone, signal_thresholds, basecamp tokens (cifrados)
  activo        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------- usuarios
create table usuarios (
  id                uuid primary key references auth.users(id) on delete cascade,
  tenant_id         uuid not null references tenants(id),
  nombre            text not null,
  email             text not null,
  rol               rol_t not null default 'colaborador',
  avatar_url        text,
  basecamp_user_id  bigint,
  capacidad_semanal int not null default 40,   -- horas
  activo            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, email)
);

-- ---------------------------------------------------------------- clientes
create table clientes (
  id                  uuid primary key,  -- MISMO ID QUE PROMETIO. No autogenerar.
  tenant_id           uuid not null references tenants(id),
  nombre              text not null,
  slug                text not null,
  logo_url            text,
  color_primario      text default '#0073EA',
  basecamp_project_id bigint,            -- proyecto raíz en Basecamp
  config              jsonb not null default '{}'::jsonb,  -- portal_pin, etc.
  activo              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references usuarios(id),
  updated_by          uuid references usuarios(id),
  deleted_at          timestamptz,
  unique (tenant_id, slug)
);

-- ---------------------------------------------------------------- plantillas
create table plantillas (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  nombre        text not null,
  descripcion   text,
  tipo          tipo_plantilla_t not null,
  activa        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, nombre)
);

create table plantilla_bloques (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  plantilla_id  uuid not null references plantillas(id) on delete cascade,
  nombre        text not null,
  peso          numeric(5,2) not null,   -- % del proyecto. Suma por plantilla = 100
  orden         int not null,
  opcional      boolean not null default false,
  constraint peso_valido check (peso > 0 and peso <= 100)
);

create table plantilla_tareas (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references tenants(id),
  bloque_id                 uuid not null references plantilla_bloques(id) on delete cascade,
  titulo_interno            text not null,
  etiqueta_cliente          text,
  visible_cliente_default   boolean not null default false,
  peso_relativo             numeric(5,2) not null default 1,
  dias_offset               int not null default 0,  -- días ANTES de la entrega del proyecto (se calcula hacia atrás)
  rol_sugerido              text,
  orden                     int not null,
  constraint etiqueta_requerida
    check (visible_cliente_default = false or etiqueta_cliente is not null)
);

-- ---------------------------------------------------------------- proyectos
create table proyectos (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants(id),
  cliente_id             uuid not null references clientes(id),
  plantilla_id           uuid references plantillas(id),
  prometio_cotizacion_id uuid,
  nombre                 text not null,
  brief                  jsonb not null default '{}'::jsonb,   -- versionado: { actual: {...}, historial: [...] }
  fecha_inicio           date not null,
  fecha_entrega          date not null,
  owner_ejecutiva        uuid references usuarios(id),
  estado                 estado_operativo not null default 'priorizado',
  basecamp_todoset_id    bigint,
  basecamp_todolist_id   bigint,
  sync_estado            sync_estado_t not null default 'pendiente',
  portal_token           text unique,
  portal_activo          boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid references usuarios(id),
  updated_by             uuid references usuarios(id),
  deleted_at             timestamptz,
  constraint fechas_coherentes check (fecha_entrega >= fecha_inicio)
);

-- Borradores creados por webhook de PrometIO (cotización ganada). Nunca ejecutables solos.
create table proyecto_borradores (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants(id),
  cliente_id             uuid not null references clientes(id),
  prometio_cotizacion_id uuid not null,
  plantilla_sugerida_id  uuid references plantillas(id),
  payload                jsonb not null,      -- webhook original (líneas, monto, fecha)
  estado                 text not null default 'pendiente',  -- pendiente | convertido | descartado
  proyecto_id            uuid references proyectos(id),
  created_at             timestamptz not null default now(),
  unique (tenant_id, prometio_cotizacion_id)
);

-- ---------------------------------------------------------------- requerimientos
create table requerimientos (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants(id),
  cliente_id             uuid not null references clientes(id),
  proyecto_id            uuid references proyectos(id) on delete cascade,
  bloque_nombre          text,
  plantilla_tarea_id     uuid references plantilla_tareas(id),

  titulo_interno         text not null,
  etiqueta_cliente       text,
  visible_cliente        boolean not null default false,

  tipo_trabajo           text not null default 'fee' check (tipo_trabajo in ('fee','proyecto')),
  estado_operativo       estado_operativo not null default 'backlog',
  estado_aprobacion      estado_aprobacion not null default 'no_aplica',
  prioridad              prioridad_t not null default 'media',

  peso                   numeric(6,3) not null default 1 check (peso >= 0),

  fecha_pedido           date,
  fecha_entrega          date,
  fecha_entrega_original date,
  veces_reprogramado     int not null default 0,

  owner_agencia          uuid[] not null default '{}',
  owner_cliente          text[],
  piezas                 int not null default 0 check (piezas >= 0),

  brief_url              text,
  entregable_urls        text[],

  -- SOLO identificadores y estado de Basecamp. NUNCA texto (docs/02 · Defensa 1).
  basecamp_todo_id       bigint,
  basecamp_todolist_id   bigint,
  basecamp_url           text,

  ultima_actualizacion   timestamptz not null default now(),
  completado_at          timestamptz,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid references usuarios(id),
  updated_by             uuid references usuarios(id),
  deleted_at             timestamptz,

  constraint etiqueta_si_visible
    check (visible_cliente = false or etiqueta_cliente is not null)
);

-- Notas de cuenta (canal de ejecutiva/líder). NO es el canal de producción.
create table notas_cuenta (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  requerimiento_id  uuid not null references requerimientos(id) on delete cascade,
  autor_id          uuid not null references usuarios(id),
  cuerpo            text not null,
  visible_cliente   boolean not null default false,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------- rituales
create table semanas (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  anio              int not null,
  numero_iso        int not null,
  fecha_inicio      date not null,
  fecha_fin         date not null,
  plan_publicado_at timestamptz,
  acta_publicada_at timestamptz,
  created_at        timestamptz not null default now(),
  unique (tenant_id, anio, numero_iso)
);

create table senales (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  semana_id     uuid not null references semanas(id),
  tipo          text not null,
  severidad     text not null check (severidad in ('critica','alta','media')),
  entidad_tipo  text not null check (entidad_tipo in ('requerimiento','usuario','cliente','proyecto','acuerdo')),
  entidad_id    uuid not null,
  titulo        text not null,
  detalle       jsonb not null default '{}'::jsonb,
  atendida      boolean not null default false,
  created_at    timestamptz not null default now()
);

create table acuerdos (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  semana_id         uuid not null references semanas(id),
  descripcion       text not null,
  responsable_id    uuid not null references usuarios(id),
  fecha_compromiso  date not null,
  estado            text not null default 'pendiente' check (estado in ('pendiente','cumplido','cancelado')),
  cerrado_at        timestamptz,
  created_at        timestamptz not null default now(),
  created_by        uuid references usuarios(id),
  -- "Próxima Weekly" no es una fecha. Fecha real obligatoria.
  constraint fecha_real check (fecha_compromiso > (created_at at time zone 'America/Guayaquil')::date)
);

create table actas (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  semana_id      uuid not null references semanas(id),
  tipo           text not null check (tipo in ('plan_operativo','cierre')),
  contenido      jsonb not null,
  markdown       text not null,
  publicado_at   timestamptz,
  publicado_por  uuid references usuarios(id),
  basecamp_doc_id bigint,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------- PrometIO
create table mapeo_servicios (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  servicio_prometio text not null,
  plantilla_id      uuid references plantillas(id),
  bloque_nombre     text,
  unique (tenant_id, servicio_prometio)
);

-- ---------------------------------------------------------------- Helpers de identidad (usados por RLS y backend)
create or replace function auth_tenant_id() returns uuid
language sql stable security definer set search_path = public as $$
  select tenant_id from usuarios where id = auth.uid()
$$;

create or replace function auth_rol() returns rol_t
language sql stable security definer set search_path = public as $$
  select rol from usuarios where id = auth.uid()
$$;

create or replace function auth_es_gestion() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select rol in ('admin','gerencia','operaciones','ejecutiva','lider')
       from usuarios where id = auth.uid()),
    false)
$$;

create or replace function auth_es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select rol = 'admin' from usuarios where id = auth.uid()), false)
$$;

revoke all on function auth_tenant_id() from public;
revoke all on function auth_rol() from public;
revoke all on function auth_es_gestion() from public;
revoke all on function auth_es_admin() from public;
grant execute on function auth_tenant_id(), auth_rol(), auth_es_gestion(), auth_es_admin() to authenticated;

-- ---------------------------------------------------------------- RLS ON (deny-all hasta que existan políticas)
alter table tenants              enable row level security;
alter table usuarios             enable row level security;
alter table clientes             enable row level security;
alter table plantillas           enable row level security;
alter table plantilla_bloques    enable row level security;
alter table plantilla_tareas     enable row level security;
alter table proyectos            enable row level security;
alter table proyecto_borradores  enable row level security;
alter table requerimientos       enable row level security;
alter table notas_cuenta         enable row level security;
alter table semanas              enable row level security;
alter table senales              enable row level security;
alter table acuerdos             enable row level security;
alter table actas                enable row level security;
alter table mapeo_servicios      enable row level security;
