# 10 · CoreIO — capa compartida de la suite

> **Estado: propuesto.** No decidido. Requiere aprobación de Luis antes de la Fase 1 de BackIO.

## Qué es

CoreIO **no es un cuarto producto**. Es un esquema compartido en Supabase más un paquete
privado que PrometIO, BackIO y DatIO consumen.

Cuando se decidió que `cliente_id` fuera el mismo UUID en PrometIO y BackIO, se inventó
CoreIO sin nombrarlo. Este documento formaliza esa intuición antes de que se convierta en
cinco convenciones informales que nadie documenta.

```
┌──────────────┬──────────────┬──────────────┐
│   PrometIO   │    BackIO    │    DatIO     │
│  (comercial) │  (operación) │ (reporting)  │
└──────┬───────┴──────┬───────┴──────┬───────┘
       └──────────────┼──────────────┘
                      │
       ┌──────────────▼──────────────┐
       │          CoreIO             │
       │ Identidad · Clientes ·      │
       │ Roles · Servicios · UI      │
       └─────────────────────────────┘
```

---

## Los cinco componentes

| Componente | Qué resuelve | Costo de no tenerlo |
|---|---|---|
| **Identidad (SSO)** | Un login para los tres sistemas | Tres tablas de usuarios. Alguien renuncia y hay que darlo de baja en tres lados; uno se olvida |
| **Tabla maestra de clientes** | El `cliente_id` ya decidido | Reconciliación manual entre "Banco Amazonas" y "BASA" |
| **Roles y permisos** | Que "ejecutiva" signifique lo mismo en los tres | Marcia es admin en uno y operaciones en otro; nadie sabe qué puede ver |
| **Catálogo de servicios** | PrometIO cotiza, BackIO ejecuta, DatIO reporta el mismo servicio | Tres listas que divergen. Rentabilidad por servicio imposible de calcular |
| **Design system** | Componentes y tokens compartidos | Un chip de estado escrito tres veces, con tres verdes distintos |

---

## El catálogo de servicios es el componente de negocio

Los otros cuatro son higiene técnica. Este responde una pregunta que hoy Geeks no puede
contestar:

> *¿Cuánto nos deja realmente una Campaña 360 versus un Fee mensual?*

Con catálogo único:

```
servicio "Campaña 360"
  → PrometIO: cuánto se cotizó, cuánto se cerró, tasa de conversión
  → BackIO:   cuántas tareas costó, cuánto se atrasó, quién la ejecutó
  → cruce:    margen real por línea de servicio
```

Para una agencia en recuperación con ~67% del revenue concentrado en dos cuentas, saber qué
servicio deja plata y cuál se vende bien pero cuesta más de lo que factura es la base de la
decisión de qué vender.

Ese dato no existe hoy. Y no puede existir sin vocabulario compartido.

---

## Esquema

Vive en un schema de Postgres separado: `core`. Cada sistema lo referencia con foreign keys.

```sql
create schema core;

-- ============================================================
-- IDENTIDAD
-- ============================================================

create table core.usuarios (
  id                uuid primary key references auth.users(id),
  tenant_id         uuid not null,
  nombre            text not null,
  email             text not null unique,
  avatar_url        text,
  activo            boolean not null default true,
  fecha_ingreso     date,
  fecha_salida      date,
  created_at        timestamptz not null default now()
);

create type core.rol_t as enum (
  'admin', 'gerencia', 'operaciones', 'ejecutiva',
  'lider', 'colaborador', 'comercial'
);

-- Un usuario puede tener rol distinto por sistema
create table core.usuario_roles (
  usuario_id  uuid not null references core.usuarios(id) on delete cascade,
  sistema     text not null,   -- prometio | backio | datio
  rol         core.rol_t not null,
  primary key (usuario_id, sistema)
);

-- IDs externos: Basecamp, Slack, etc.
create table core.usuario_identidades (
  usuario_id  uuid not null references core.usuarios(id) on delete cascade,
  proveedor   text not null,   -- basecamp | slack | google
  external_id text not null,
  primary key (usuario_id, proveedor)
);

-- ============================================================
-- CLIENTES (fuente de verdad de la suite)
-- ============================================================

create table core.clientes (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,
  nombre              text not null,
  nombre_legal        text,
  ruc                 text,
  slug                text not null,
  logo_url            text,
  color_primario      text,
  activo              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, slug)
);

-- Configuración por sistema, sin contaminar la tabla maestra
create table core.cliente_config (
  cliente_id  uuid not null references core.clientes(id) on delete cascade,
  sistema     text not null,
  config      jsonb not null default '{}'::jsonb,
  primary key (cliente_id, sistema)
);
-- backio → { basecamp_project_id, portal_pin }
-- datio  → { meta_page_id, ig_account_id, tiktok_id }

create table core.contactos (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references core.clientes(id) on delete cascade,
  nombre      text not null,
  email       text,
  cargo       text,
  activo      boolean not null default true
);

-- ============================================================
-- CATÁLOGO DE SERVICIOS
-- ============================================================

create table core.servicios (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  codigo        text not null,        -- CAM360, FEE-CONT, TRADE-POP
  nombre        text not null,
  categoria     text not null,        -- creatividad | contenido | produccion | trade | digital
  unidad        text not null,        -- proyecto | mes | pieza | hora
  activo        boolean not null default true,
  unique (tenant_id, codigo)
);

-- Mapeo servicio → plantilla de BackIO (reemplaza mapeo_servicios local)
create table core.servicio_plantilla (
  servicio_id   uuid not null references core.servicios(id),
  plantilla_id  uuid not null,        -- FK lógica a backio.plantillas
  primary key (servicio_id)
);

-- ============================================================
-- AUDITORÍA TRANSVERSAL
-- ============================================================

create table core.audit_log (
  id          bigserial primary key,
  tenant_id   uuid not null,
  sistema     text not null,
  usuario_id  uuid references core.usuarios(id),
  api_key_id  uuid,
  accion      text not null,
  entidad     text not null,
  entidad_id  uuid,
  detalle     jsonb,
  created_at  timestamptz not null default now()
);
```

---

## Impacto en BackIO

Si CoreIO se aprueba, `01-modelo-datos.md` cambia así:

| Tabla de BackIO | Cambio |
|---|---|
| `clientes` | **Se elimina.** FK a `core.clientes` |
| `usuarios` | **Se elimina.** FK a `core.usuarios` + `core.usuario_roles` |
| `mapeo_servicios` | **Se elimina.** Pasa a `core.servicio_plantilla` |
| `clientes.basecamp_project_id` | Migra a `core.cliente_config` con `sistema = 'backio'` |
| `tenants` | Se mueve a `core.tenants` |

**Por eso la decisión debe tomarse antes de la Fase 0.** Después implica migrar tablas con
datos y reescribir foreign keys.

---

## Paquete compartido

```
geeks-core/
  schema/
    migrations/            → SQL de core.*
  packages/
    @geeks/auth            → SSO, useSession(), guards de rol por sistema
    @geeks/types           → Cliente, Usuario, Servicio, Rol
    @geeks/ui              → EstadoChip, DataTable, tokens de color y tipografía
    @geeks/client          → SDK tipado para leer core.* desde cualquier sistema
  admin/
    app/                   → alta/baja de usuarios, clientes, servicios
```

---

## Lo que CoreIO NO es

| No es | Por qué |
|---|---|
| Un microservicio con API propia | Es un esquema + un paquete npm. Nada más |
| Un producto con UI compleja | Solo una pantalla de admin |
| Un proyecto de semanas | Si pasa de 5 días, se salió del alcance |
| Una plataforma de integración | No orquesta nada. Solo provee identidad y vocabulario |
| La cáscara del portal cliente | Descartado: DatIO y BackIO quedaron independientes |

**Señal de desviación:** si CoreIO empieza a "hacer cosas" en lugar de solo proveer datos
compartidos, se salió del alcance. Detener y revisar.

---

## Aritmética del momento

| Cuándo | Costo |
|---|---|
| **Ahora**, antes de Fase 0 de BackIO | 3 días |
| En 6 meses | 3-4 semanas: migrar usuarios activos, reconciliar catálogos, refactorizar frontends en producción |
| Nunca | Permanente: cada reporte cruzado es manual, cada alta de personal son tres pasos, cada divergencia es un bug de confianza |

La ventana es ahora precisamente porque BackIO todavía no existe.

---

## La condición

CoreIO sin dueño se convierte en el lugar que nadie quiere tocar, y termina generando
acoplamiento sin gobierno — peor que no tenerlo.

Requiere un responsable nombrado antes de escribirse. Y si ese responsable es Luis, CoreIO
lo ata más a la operación técnica, no menos, lo cual contradice la estrategia de extracción
declarada para el año.

**La decisión de product owner ya no es solo de BackIO. Es de la suite completa.**
