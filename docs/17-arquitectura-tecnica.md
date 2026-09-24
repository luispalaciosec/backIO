# 17 · Arquitectura técnica (nivel software)

Documento para quien va a **mantener** BackIO: cómo está armado el código, por dónde entra una
petición, quién escribe en la base, qué corre solo y dónde no se toca sin revisión. Los documentos
`00`–`16` explican el *qué* y el *por qué*; este explica el *cómo*.

Estado al 23/09/2026: 128 commits desde el 03/09, en producción desde el 04/09.

---

## 1. Mapa del monorepo

```
backio/
├── shared/      Tipos TS compartidos (@backio/shared) + sanitizeForClient (única salida al cliente)
├── backend/     API Hono (Node 20+) · migraciones Supabase · integraciones · crons · MCP
├── frontend/    Next.js 14 App Router + Tailwind · consume el backend por HTTP
├── docs/        Specs (00–16), este documento, manual de uso (docs/manual)
├── CLAUDE.md    Reglas del proyecto, zonas de revisión humana
└── pnpm-workspace.yaml
```

| Paquete | Entrada | Pruebas | Notas |
|---|---|---|---|
| `shared` | `src/index.ts` | `src/__tests__/sanitize.test.ts` | Sin dependencias de runtime. `types.ts` (entidades), `api.ts` (contratos de respuesta), `sanitize.ts` |
| `backend` | `src/index.ts` → `createApp()` en `src/app.ts` | `vitest` (8 archivos, 40 tests) | `tsx` en dev y prod, `tsc` para typecheck |
| `frontend` | `app/layout.tsx` | build de Next | `middleware.ts` protege rutas; `lib/api.ts` habla con el backend |

Comandos raíz: `pnpm dev`, `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`.

---

## 2. Backend: ciclo de una petición

```
Cliente (Next / agente / webhook)
   │  Authorization: Bearer <JWT Supabase | bk_<api key> | token OAuth MCP>
   ▼
src/app.ts        secureHeaders → CORS por prefijo → logger → montaje de routers
   ▼
src/routes/v1/index.ts   middleware auth en '*' → resuelve `Auth` (tenant, usuario, rol, scopes)
   ▼
src/routes/v1/<recurso>.ts   requireScope(...) · zValidator (zod) · handler
   ▼
src/lib/<dominio>.ts      lógica (rituales, cumplimiento, horas, personas, IA, basecamp…)
   ▼
src/lib/db/<tabla>.ts     única capa que toca Supabase (regla del proyecto: nada de queries en rutas)
   ▼
Supabase Postgres + RLS   políticas por tenant_id · triggers · vistas de métricas
```

### 2.1 Routers montados (`src/app.ts`)

| Prefijo | Archivo | Auth | Para qué |
|---|---|---|---|
| `/health` | app.ts | — | Latido para Railway |
| `/api/v1/auth` | `routes/auth_publico.ts` | público | Recuperación de contraseña (montado ANTES del router con auth) |
| `/api/v1/webhooks/prometio` | `routes/webhooks/prometio.ts` | secreto compartido | Alta de cliente/proyecto desde el CRM |
| `/api/v1/*` | `routes/v1/index.ts` | JWT / API key / OAuth | Toda la API de la app (17 routers: clientes, proyectos, requerimientos, semanas, usuarios, basecamp, admin, mesas, dashboard, tipos-pieza, huerfanos, horas, ia, recurrencias, personas, actividad, plantillas) |
| `/api/portal` | `routes/portal.ts` | token de portal (+ PIN opcional) | Lo que ve el cliente. Pasa por `sanitizeForClient` |
| `/api/webhooks/basecamp` | `routes/webhooks/basecamp.ts` | secreto | Eventos de to-dos (solo campos permitidos) |
| `/api/cron` | `routes/cron.ts` | secreto | Disparadores externos (Vercel Cron) cuando no corre el scheduler interno |
| `/api/basecamp` | `routes/basecamp.ts` | admin | OAuth2 con Basecamp (conectar cuenta) |
| `/mcp`, `/oauth`, `/.well-known` | `routes/mcp.ts`, `routes/oauth.ts` | OAuth propio | MCP Server para Claude/ChatGPT y su servidor de autorización |
| `/api/openapi.json` | `routes/openapi.ts` | — | Especificación para agentes |

### 2.2 Autenticación y autorización (`src/lib/auth/middleware.ts`)

Tres credenciales, un solo objeto `Auth` en el contexto:

| Credencial | Cómo se resuelve | `db` que recibe el handler |
|---|---|---|
| JWT de Supabase (usuario de la app) | `supabase.auth.getUser` + fila en `usuarios` (tenant, rol, activo) | Cliente **con el JWT del usuario**: RLS aplica |
| `bk_<key>` (API key: agentes, PrometIO) | Hash en `api_keys` + scopes | **Service role** + filtro explícito por `tenant_id` en cada query |
| Token OAuth del MCP | `oauth_tokens` → usuario dueño + scopes | Como el usuario, acotado a los scopes concedidos |

`requireScope('read:backlog' | 'write:requerimientos' | 'write:actas' | 'admin' …)`:
- Usuario de la app: lectura para todos los roles; escritura solo para roles de gestión
  (`admin`, `gerencia`, `operaciones`, `ejecutiva`, `lider`); `admin` solo para admin.
- API key / OAuth: se exige el scope literal.
- Excepción: `escrituraOPropia` (en `routes/v1/requerimientos.ts`) deja que un `colaborador`
  edite **sus** tareas y solo los campos de `CAMPOS_COLABORADOR`.

Roles (`usuarios.rol`): `admin`, `gerencia`, `operaciones`, `ejecutiva`, `lider`, `colaborador`.

### 2.3 Acceso a datos (`src/lib/db/`)

- `client.ts`: `userClient(jwt)` y `serviceClient()`. `DbCtx = { db, tenantId, usuarioId, origen }`.
  `origen` ∈ `ui | api | mcp | cron | webhook | script` y viaja a la auditoría.
- Un archivo por tabla o dominio: `requerimientos.ts` (incluye `listBacklog` sobre la vista
  `v_requerimientos_metricas` y el filtro por mesa), `proyectos.ts`, `clientes.ts`, `usuarios.ts`,
  `mesas.ts` (`alcanceMesa`: clientes + proyectos de una mesa), `semanas.ts`, `historial.ts`
  (reprogramaciones/reprocesos), `bitacora.ts`, `audit.ts`.
- **PostgREST corta en 1000 filas.** Toda lectura que pueda superar eso pagina con `.range()`
  en bucle (huérfanos, horas, informe por canal, bitácora, scripts). Ya nos mordió tres veces.
- `audit()` escribe **siempre con service role** (la tabla no tiene política de insert para usuarios).

### 2.4 Base de datos (Supabase)

33 tablas, todas con `tenant_id` y RLS (`auth_tenant_id()` desde el JWT). Las que importan:

| Grupo | Tablas |
|---|---|
| Identidad | `tenants`, `usuarios`, `invitaciones`, `api_keys`, `oauth_clients/codes/tokens`, `mesas` |
| Backlog | `clientes`, `proyectos`, `requerimientos`, `plantillas`, `plantilla_bloques/tareas`, `tipos_pieza`, `recurrencias` |
| Cumplimiento | `reprogramaciones`, `reprocesos`, `bitacora` |
| Rituales | `semanas`, `senales`, `acuerdos`, `actas` |
| Integración | `horas` (timesheet), `basecamp_huerfanos`, `mapeo_servicios` (PrometIO), `notificaciones` |
| Agentes / IA | `agent_plans` (preview+confirm), `ia_generaciones` (caché por hash de prompt), `portal_resumenes` |
| Trazabilidad | `audit_log` (alimenta Auditoría, Día a día, Entradas desde Basecamp) |

Vistas: `v_requerimientos_metricas` (atraso, sin movimiento, veces reprogramado/reproceso, planificación),
`v_proyectos_avance`. Triggers relevantes: `enforce_visibilidad_monotonica` (regla 2: nunca abrir
visibilidad), `requerimientos_before_insert/update` (fecha original, `completado_at`, planificación
automática), `proyectos_recalcular_estado` (proyecto completado cuando todas sus tareas lo están),
`ensure_semana`, `handle_new_auth_user`.

Migraciones en `backend/supabase/migrations/`, numeradas `YYYYMMDD0000NN_nombre.sql` (hoy 01–20).
**Regla operativa:** todo SQL se entrega como archivo secuencial y lo corre Luis en el SQL editor
de Supabase (el conector MCP perdió permisos de SQL el 07/09).

---

## 3. Integraciones

### 3.1 Basecamp (`src/lib/basecamp/`)

| Archivo | Rol | Zona de revisión |
|---|---|---|
| `client.ts` | Cliente HTTP: OAuth refresh, throttle, paginación (`requestAll`), extractores "safe" que solo devuelven campos permitidos (`listTodosSafe`, `timesheetSafe`, `listPeopleSafe`) | — |
| `oauth.ts` | Tokens del tenant en DB, refresh | — |
| `sync.ts` | Webhook: `completed`, `completed_at`, `due_on`, `assignee_ids`, papelera/archivado. **Nunca extrae texto** (`sync.test.ts` lo garantiza) | — |
| `reconcile.ts` | Polling cada 30 min: converge `completed` desde Basecamp y empuja `due_on` desde BackIO (regla 3) | — |
| `importar.ts` | Sincronización de estructura cada 30 min: listas → proyectos, grupos → bloques, to-dos → requerimientos (solo título, excepción D1), renombres, movimientos, responsables, eliminados | — |
| `huerfanos.ts` | Detector manual de to-dos sin requerimiento (ya no corre por cron desde el 23/09) | — |
| `write.ts` | Escritura a producción real: crear listas/grupos/to-dos, `pushDueDate`, `reabrirTodo` | **Sí (CLAUDE.md)** |

Lecciones incorporadas al código (ver `docs/04-basecamp.md`):
- `PUT` sobre un to-do es reemplazo total → `updateTodo` lee el to-do y reenvía todos los campos.
- El reporte de timesheet ignora `bucket_id` → una sola llamada y atribución por `bucket.id` de cada entrada.
- Menciones en mensajes: `attachable_sgid` de `people.json` → `<bc-attachment content-type="application/vnd.basecamp.mention">`.

### 3.2 PrometIO (`routes/webhooks/prometio.ts`, `docs/08`)
Webhook firmado con `PROMETIO_WEBHOOK_SECRET`. Comparte `cliente_id`. Crea cliente/proyecto desde una cotización.

### 3.3 Anthropic (`src/lib/ia/`)
`index.ts` → `generarTexto()` con `thinking` desactivado, caché en `ia_generaciones` por hash de
prompt+modelo, errores traducidos (`traducirErrorIA`). Redactores: `daily.ts` (apertura/cierre en
markdown simple → HTML con `markdownBasico`), `weekly.ts` (formato NARRATIVA/AGENDA en texto plano),
`informe.ts`, brief y recordatorios. **La IA redacta; una persona publica** (`docs/15-ia.md`).

### 3.4 MCP Server (`src/lib/mcp/`, `routes/mcp.ts`)
Herramientas de lectura y de escritura con preview+confirm (`agent_plans`, `plan_id` de 15 min, un
solo uso). `publish.ts` arma el HTML de dailies, actas e informes que van a Basecamp. Alerta si una
API key hace más de 20 escrituras en 5 min (`audit.ts`).

---

## 4. Lo que corre solo (`src/lib/scheduler.ts`, activo con `ENABLE_INTERNAL_CRON=1`)

| Cada | Qué | Función |
|---|---|---|
| 30 min | Reconciliación con Basecamp (`completed`, `due_on`) | `reconcileTenant` |
| 30 min (+10) | Estructura de Basecamp: listas, grupos, to-dos, responsables, eliminados | `importarBasecampCliente` |
| 6 h | Horas del timesheet (una llamada, toda la cuenta) | `sincronizarHoras` |
| 1 min | Cola de notificaciones por correo | `procesarPendientes` |
| Diario 08:05 | Recurrencias de fees (D2) | `procesarRecurrencias` |
| Día 1, 08:00 | Informe ejecutivo mensual por mesa (solo redacta) | `informe.ts` |
| Domingo 18:00 | Señales del weekly + agenda por correo | `recalcularSenales` |

Todos usan `serviceClient()` con `origen: 'cron'` y escriben en `audit_log`. Si un cron falla solo
se ve en los logs de Railway: **no hay alerta todavía** (ver §8).

---

## 5. Frontend (Next.js 14, App Router)

```
frontend/
├── middleware.ts            redirige a /login sin sesión; deja pasar estáticos y /p (portal)
├── app/
│   ├── (app)/               área interna: layout con Sidebar (grupos plegables) y páginas
│   │   ├── backlog/         tabla estilo Monday: filtros en URL, columnas fijas, celdas editables
│   │   ├── proyectos/, daily/, weekly/, personas/, dia-a-dia/, huerfanos/ (Entradas Basecamp)
│   │   ├── informes/        mensuales, por canal, estatus por cliente
│   │   └── admin/           clientes, mesas, usuarios, plantillas, tipos de pieza, recurrencias,
│   │                        integraciones, api-keys, servicios (salud), auditoría
│   ├── p/[token]/           portal del cliente (público por token)
│   ├── auth/, login/, oauth/
├── components/
│   ├── backlog/             BacklogTable, Celdas (CeldaSelect/Owners/Fecha/Texto), HistorialReq,
│   │                        Bitacora, MotivoReprogramacion, RecordatorioIA
│   ├── Sidebar.tsx, VistaCliente.tsx, ui/, dashboard/, informe/
└── lib/
    ├── api.ts / api.server.ts   fetch al backend con el JWT de Supabase (cliente / servidor)
    ├── me.server.ts / useMe.ts  usuario actual y permisos de UI (`puedeEscribir`)
    ├── orden.ts, format.ts      orden del backlog; fechas en America/Guayaquil (`diaLocal`)
    └── supabase/                clientes de Supabase para browser y server components
```

Convenciones: los permisos de UI solo esconden; **el backend es el que decide**. `localStorage`
únicamente para preferencias (grupos del menú, filtros como respaldo, última mesa del daily), nunca
datos de negocio. Fechas en UTC en la base, se muestran en Guayaquil.

---

## 6. Pruebas

| Archivo | Qué protege |
|---|---|
| `shared/src/__tests__/sanitize.test.ts` | Defensa 2: lo que sale al cliente nunca lleva campos internos |
| `backend/src/lib/basecamp/sync.test.ts` | Defensa 1: el webhook no extrae texto de Basecamp |
| `backend/src/__tests__/portal.test.ts` | Contrato del portal (estados internos no aparecen) |
| `backend/src/__tests__/auth_publico.test.ts` | Recuperación de contraseña sin enumerar correos |
| `backend/src/lib/rituals/signals.test.ts` | Motor de señales del weekly |
| `backend/src/lib/builder/plan.test.ts`, `import.test.ts` | Builder e importación CSV |
| `backend/src/__tests__/daily_publish.test.ts` | Formato del daily: por persona, cierre, métricas, menciones |

Sin cobertura todavía: sincronización de estructura, reconciliación, horas, permisos por rol en
rutas, RLS con un tenant real distinto. Es la deuda principal (ver §8).

---

## 7. Despliegue y operación

| Pieza | Dónde | Cómo se despliega |
|---|---|---|
| Backend | Railway, proyecto `protective-dream`, servicio `@backio/backend`, entorno `production` | Automático en cada push a `main` (Dockerfile). Logs: `railway logs -p protective-dream -s "@backio/backend" -e production --lines 300` |
| Frontend | Vercel, `backio.vercel.app` | **Manual**: `vercel deploy --prod --yes` desde la raíz (el deploy por GitHub está bloqueado en el plan Hobby con repo privado) |
| Base + Auth | Supabase, proyecto `gckjyjvqvdfayjrtfbmj` | Migraciones a mano en el SQL editor |
| Correo | Resend (`lib/notificaciones`) | — |

Variables de entorno: ver `docs/11-setup.md`. Backend valida con zod al arrancar
(`src/config/env.ts`); frontend usa `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_BACKEND_URL`.

Scripts operativos en `backend/scripts/` (se corren en local contra producción con el `.env`):
diagnóstico de fechas y asignados, detección y limpieza de duplicados, reparación de asignados,
altas/bajas de clientes, presets del informe por canal. **Requieren `BASECAMP_ACCOUNT_ID` en el
entorno** para hablar con Basecamp.

---

## 8. Deuda técnica conocida (priorizada)

1. **Sin CI.** Nada corre `typecheck` y `test` antes de desplegar. Acción: GitHub Actions en cada push.
2. **Sin staging.** Todo cambio va a producción. Acción: rama de Supabase + proyecto Basecamp sandbox
   (ya existe el cliente de pruebas "Acme EC S.A.S", proyecto 48775530).
3. **Sin alertas de crons.** Acción: correo a operaciones si un cron falla o no corre en su ventana.
4. **Tests de integración con Basecamp** sobre el sandbox: actualizar fecha sin perder asignados,
   timesheet, importación, papelera.
5. **Reparaciones de datos por script local.** Acción: convertir las recurrentes en endpoints de admin.
6. **Portal:** mostrar notas de bitácora `visible_cliente` (toca `lib/visibility/`, revisión humana).
7. **Deploy manual del frontend.** Acción: plan Pro de Vercel o GitHub Action que ejecute `vercel deploy`.

---

## 9. Dónde mirar cuando algo falla

| Síntoma | Primer lugar |
|---|---|
| Un cambio en Basecamp no se ve en BackIO | Logs de Railway (`[scheduler] estructura`), luego `audit_log` acción `basecamp_importar` del cliente |
| Una fecha de BackIO no llegó a Basecamp | `audit_log` acción `reprogramar` y `webhook_basecamp`; `reconcile.ts` la reintenta en 30 min |
| Asignados desaparecen en Basecamp | `client.ts:updateTodo` debe reenviar `assignee_ids` (incidente 22/09 en `docs/04`) |
| La IA da error | `traducirErrorIA` en `lib/ia/index.ts`; el mensaje llega tal cual a la UI |
| Un usuario no ve algo | Primero `requireScope` de la ruta, luego la política RLS de la tabla |
| Horas raras por cliente | `sincronizarHoras`: atribución por `bucket.id` de cada entrada |
