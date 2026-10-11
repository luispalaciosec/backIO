# 11 · Setup y estructura del repositorio

> Revisado contra el código el 11/10/2026.

## Requisitos

- Node 20 o superior (`engines` en `package.json`). El CI y la imagen Docker del backend usan Node 22.
- pnpm en la versión que fija `packageManager` en el `package.json` raíz. Con `corepack enable` se instala sola.

## Estructura

```
backIO/
  shared/            Tipos de dominio, contratos API, sanitizeForClient (única función de salida al cliente),
                     métricas, fechas en Guayaquil y etiquetas compartidas
  backend/           API Hono/TypeScript + migraciones Supabase
    supabase/
      migrations/    SQL versionado, numerado en orden
      seed.sql       Tenant Geeks + 5 plantillas + mapeo de servicios
      seed_catalogo.sql  Catálogo consolidado: familias → plantillas + mapeo del tarifario
      config.toml    Configuración del CLI de Supabase (project ref)
    scripts/         Diagnóstico y reparación contra producción, generación de tipos y de la referencia de la API
    src/
      lib/db/        ÚNICA capa que toca Supabase
      lib/auth/      JWT Supabase (UI), API key con scopes (agentes, PrometIO) o token OAuth del MCP
      lib/builder/   Plan de proyecto (pesos, fechas hacia atrás, alerta de carga) + import CSV
      lib/basecamp/  sync.ts (extracción estricta) · client.ts · write.ts (zona de revisión) · reconcile.ts ·
                     importar.ts · decisiones.ts · recorrer.ts · huerfanos.ts · webhooks.ts · credenciales.ts
      lib/rituals/   Motor de señales · Daily · Plan Operativo · Acta de Cierre
      lib/portal/    Token firmado · PIN con hash · resumen ejecutivo IA (Claude)
      lib/visibility/ Re-export de shared + guard (zona de revisión)
      lib/mcp/       MCP Server y sus herramientas (tools/: lectura y escritura con preview + confirmación)
      lib/oauth/     Servidor de autorización OAuth para los agentes del MCP
      lib/ia/        Redactores con Claude: daily, weekly, informe, brief, recordatorios
      lib/notificaciones/  Cola de correos (Resend)
      lib/requerimientos/  Actualización de tareas común a la REST y al MCP
      lib/jobs.ts · scheduler.ts · vigia.ts   Tareas programadas, el tick que las corre y el vigía que avisa si no corren
      lib/logger.ts · sentry.ts               Log con niveles y envío de errores a Sentry
      routes/        /api/v1 · /api/portal · /api/webhooks · /api/cron · /api/basecamp · /api/openapi.json ·
                     /mcp · /oauth · /.well-known
  frontend/          Next.js 15.5 (React 19) App Router + Tailwind
    app/(app)/       backlog · proyectos (nuevo: Builder 5 pasos · importar) · daily · weekly · dia-a-dia ·
                     dashboard · evolutivo · kpis · personas · huerfanos · informes · admin/*
    app/p/[token]/   Portal cliente público (consume /api/portal)
    app/auth/        Recuperar contraseña y definir clave
    app/oauth/       Pantalla de consentimiento para los agentes del MCP
    lib/api.ts       Cliente HTTP al backend (token de sesión Supabase, sin localStorage)
  docs/              Sitio de documentación (VitePress)
```

Backend y frontend son despliegues independientes. El frontend nunca consulta Supabase
para datos de negocio: solo para autenticación. Toda lectura/escritura va por el backend.

## Variables de entorno

Hay un archivo de ejemplo por paquete. El `.env.example` de la raíz solo es un índice.

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

Cada variable lleva un comentario que dice qué hace y si es opcional. Para correr en local alcanza con las de
Supabase; sin las de Basecamp, IA, correo, Turnstile o Sentry, esas funciones quedan apagadas.

## Correr en local

```bash
pnpm install
pnpm dev                               # backend http://localhost:4000 y frontend http://localhost:3000
```

También se puede levantar cada uno por separado:

```bash
pnpm --filter @backio/backend dev      # http://localhost:4000
pnpm --filter @backio/frontend dev     # http://localhost:3000
```

Otros comandos desde la raíz: `pnpm typecheck`, `pnpm lint` (ESLint y Prettier), `pnpm test`. En cada paquete,
`pnpm --filter <paquete> format` aplica el formato. En el backend:

```bash
pnpm --filter @backio/backend db:types    # regenera los tipos de la base (src/lib/db/database.types.ts)
pnpm --filter @backio/backend docs:api    # regenera la referencia de la API (docs/referencia-api.md)
```

Este sitio de documentación se levanta con `pnpm --filter @backio/docs dev`.

## Base de datos

Las migraciones están en `backend/supabase/migrations/`, numeradas `YYYYMMDD0000NN_nombre.sql` en el orden en que se
aplican. Las recientes son idempotentes y traen al final una consulta para verificar que quedaron aplicadas. Las que tocan RLS, el alta
de usuarios o funciones `SECURITY DEFINER` son zona de revisión humana (`CLAUDE.md`).

Todo SQL nuevo se entrega como el siguiente archivo de la secuencia y lo aplica Luis en el SQL editor de Supabase. El
procedimiento completo, incluida la regeneración de tipos, está en
[Aplicar una migración](./operacion.md#aplicar-una-migracion).

Después de las migraciones van `seed.sql` (tenant, plantillas base, mapeo de servicios) y `seed_catalogo.sql`
(catálogo de plantillas por familia).

<details>
<summary>Historia: estado al 03/09/2026</summary>

Las cuatro primeras migraciones y el seed se aplicaron el 03/09 en `gckjyjvqvdfayjrtfbmj`: la 0001 y la 0003 por MCP
(quedaron registradas en `supabase_migrations`), la 0002, la 0004 y el seed desde el SQL Editor. Si alguna vez se usa
`supabase db push` desde el CLI, antes hay que marcar como aplicadas las que no quedaron registradas, por ejemplo:

```bash
npx supabase migration repair --status applied 20260903000002 20260903000004
```

</details>

## Usuarios

Las personas se dan de alta desde **Admin → Usuarios → invitar**, con nombre, rol y capacidad. Les llega un correo
para definir su contraseña. Desde la migración 26 la fila en `usuarios` se crea solo cuando el correo queda
confirmado (al aceptar la invitación); mientras tanto, la persona aparece en «Invitaciones».

Sin invitación, un correo confirmado de un dominio en `tenants.dominios_auto` (`geeks.com.ec`, `geeks.ec`) entra como
`colaborador`. Cualquier otro dominio no recibe acceso. El registro público está apagado en Supabase Auth.

Roles: `admin`, `gerencia`, `operaciones`, `ejecutiva`, `lider`, `colaborador`. El rol se cambia en Admin → Usuarios.
Para dar de baja a alguien: «Quitar acceso» en la misma pantalla (ver [Operación](./operacion.md#dar-de-alta-o-quitar-a-una-persona)).

## API keys

Se crean en **Admin → API keys**, y solo las puede crear una persona admin con su sesión (no otra key). La clave tiene
la forma `bk_live_` seguido de 24 bytes aleatorios en base64url. Se muestra una sola vez; en la base queda su hash
sha256 y el prefijo (los primeros 12 caracteres) para reconocerla en el listado. Una key de perfil `cliente` queda
atada a un solo cliente.
