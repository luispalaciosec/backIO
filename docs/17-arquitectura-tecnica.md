# 17 · Arquitectura técnica (nivel software)

> Revisado contra el código el 11/10/2026.

Documento para quien va a **mantener** BackIO: cómo está armado el código, por dónde entra una
petición, quién escribe en la base, qué corre solo y dónde no se toca sin revisión. Los documentos
`00`–`16` explican el *qué* y el *por qué*; este explica el *cómo*.

Estado al 11/10/2026. En producción desde el 04/09/2026.

---

## 1. Mapa del monorepo

```
backio/
├── shared/      Tipos TS compartidos (@backio/shared) + sanitizeForClient (única salida al cliente)
├── backend/     API Hono (Node 22 en producción y CI; engines ≥20) · migraciones Supabase · integraciones · jobs · MCP
├── frontend/    Next.js 15.5 (React 19) App Router + Tailwind · consume el backend por HTTP
├── docs/        Sitio VitePress: specs 00–19, guías (empezar, operación, decisiones, glosario, referencia de la API,
│                endurecimiento), este documento y el manual de uso (docs/manual)
├── CLAUDE.md    Reglas del proyecto, zonas de revisión humana
├── HARDENING-CHANGELOG.md   Detalle de la auditoría externa del 10/10 y su corrección
└── pnpm-workspace.yaml
```

| Paquete | Entrada | Pruebas | Notas |
|---|---|---|---|
| `shared` | `src/index.ts` | `vitest` en `src/__tests__/` | Sin dependencias de runtime. `types.ts` (entidades), `api.ts` (contratos de respuesta), `visibility/sanitize.ts`, `metricas.ts` (`porcentaje`, `formatoFraccion`, `cerradaATiempo`), `fechas.ts` (días en Guayaquil), `etiquetas.ts` (etiquetas de estados y `CAMPOS_COLABORADOR`) |
| `backend` | `src/index.ts` → `createApp()` en `src/app.ts` | `vitest` en `src/__tests__/` y algunos `src/lib/**/*.test.ts` | `tsx` en dev y prod, `tsc` para typecheck |
| `frontend` | `app/layout.tsx` | `vitest` en `lib/__tests__/` + build de Next | `middleware.ts` protege rutas y arma la CSP; `lib/api.ts` habla con el backend |

Las tres suites corren en el CI en cada push. Para ver cuántas pruebas hay hoy, correr `pnpm test`.

Comandos raíz: `pnpm dev`, `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`.

---

## 2. Backend: ciclo de una petición

```
Cliente (Next / agente / webhook)
   │  Authorization: Bearer <JWT Supabase | bk_<api key> | token OAuth MCP>
   ▼
src/app.ts        secureHeaders (CSP default-src 'none') → logPeticiones (ruta redactada) → bodyLimit (1 MB; 2 MB
                  en la importación CSV) → CORS por prefijo → montaje de routers
   ▼
src/routes/v1/index.ts   middleware auth en '*' → resuelve `Auth` (tenant, usuario, rol, scopes)
   ▼
src/routes/v1/<recurso>.ts   requireScope(...) · zValidator (zod) · handler
   ▼
src/lib/<dominio>.ts      lógica (rituales, cumplimiento, horas, personas, KPIs, IA, basecamp…)
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
| `/api/v1/webhooks/prometio` | `routes/webhooks/prometio.ts` | firma HMAC | Alta de cliente/proyecto desde el CRM |
| `/api/v1/*` | `routes/v1/index.ts` | JWT / API key / OAuth | Toda la API de la app (19 routers: clientes, plantillas, proyectos, requerimientos, semanas, usuarios, basecamp, admin, mesas, dashboard, tipos-pieza, huerfanos, horas, ia, recurrencias, personas, actividad, kpis, evolutivo) |
| `/api/portal` | `routes/portal.ts` | token de portal (+ PIN opcional) | Lo que ve el cliente. Pasa por `sanitizeForClient` |
| `/api/webhooks/basecamp` | `routes/webhooks/basecamp.ts` | secreto en la URL | Eventos de to-dos (solo campos permitidos) |
| `/api/cron` | `routes/cron.ts` | `CRON_SECRET` | Disparadores externos de los jobs cuando no corre el scheduler interno |
| `/api/basecamp` | `routes/basecamp.ts` | admin | OAuth2 con Basecamp (conectar cuenta) |
| `/mcp`, `/oauth`, `/.well-known` | `routes/mcp.ts`, `routes/oauth.ts` | OAuth propio | MCP Server para Claude/ChatGPT y su servidor de autorización |
| `/api/openapi.json` | `routes/openapi.ts` | — | Especificación para agentes (de ahí sale la [referencia de la API](./referencia-api.md)) |

### 2.2 Autenticación y autorización (`src/lib/auth/middleware.ts`)

Tres credenciales, un solo objeto `Auth` en el contexto:

| Credencial | Cómo se resuelve | `db` que recibe el handler |
|---|---|---|
| JWT de Supabase (usuario de la app) | `supabase.auth.getUser` + fila en `usuarios` (tenant, rol, activo) | Cliente **con el JWT del usuario**: RLS aplica |
| `bk_<key>` (API key: agentes, PrometIO) | Hash en `api_keys` + scopes. Las de perfil `cliente` se rechazan en la REST (solo sirven por el MCP) y quedan atadas a su cliente (S11) | **Service role** + filtro explícito por `tenant_id` en cada query |
| Token OAuth del MCP | `oauth_tokens` → usuario dueño (activo) + scopes concedidos | **Service role** con el tenant y el rol del dueño, acotado a los scopes concedidos. Nunca alcanza rutas admin, aunque el dueño sea admin |

`requireScope('read:backlog' | 'write:requerimientos' | 'write:actas' | 'admin' …)`:
- Usuario de la app: lectura para todos los roles; escritura solo para roles de gestión
  (`admin`, `gerencia`, `operaciones`, `ejecutiva`, `lider`); `admin` solo para admin.
- API key / OAuth: se exige el scope literal.
- Excepción: `escrituraOPropia` (en `routes/v1/requerimientos.ts`) deja que un `colaborador`
  edite **sus** tareas y solo los campos de `CAMPOS_COLABORADOR`. La regla se aplica en
  `lib/requerimientos/actualizar.ts` (catálogo en `shared/src/etiquetas.ts`), el mismo camino para la REST y el MCP.

Roles (`usuarios.rol`): `admin`, `gerencia`, `operaciones`, `ejecutiva`, `lider`, `colaborador`.

### 2.3 Acceso a datos (`src/lib/db/`)

- `client.ts`: `userClient(jwt)` y `serviceClient()`. `DbCtx = { db, tenantId, usuarioId, origen }`.
  `origen` ∈ `ui | api | mcp | webhook:basecamp | webhook:prometio | cron | portal` y viaja a la auditoría.
- Un archivo por tabla o dominio: `requerimientos.ts` (incluye `listBacklog` sobre la vista
  `v_requerimientos_metricas` y el filtro por mesa), `proyectos.ts`, `clientes.ts`, `usuarios.ts`,
  `mesas.ts` (`alcanceMesa`: clientes + proyectos de una mesa), `semanas.ts`, `historial.ts`
  (reprogramaciones/reprocesos), `bitacora.ts`, `audit.ts`, `plantillas.ts`, `tipos_pieza.ts`, `admin.ts`
  (invitaciones, API keys), `basecamp_import.ts`, `kpis.ts`, `tenants.ts`, `cron_runs.ts` (registro de jobs),
  `lote.ts` (llama a la RPC `crear_lote`) y `paginar.ts`. Desde el 11/10/2026 cada módulo de dominio de `lib/`
  tiene su par en `lib/db` (`evolutivo.ts`, `informes.ts`, `oauth.ts`, `notificaciones.ts`, `portal.ts`,
  `huerfanos.ts`, `credenciales.ts`, `mantenimiento.ts`…).
- `database.types.ts` son los tipos generados del esquema. No se edita a mano: se regenera con
  `pnpm --filter @backio/backend db:types` después de cada migración.
- **PostgREST corta en 1000 filas.** Toda lectura que pueda superar eso pagina con `.range()`
  en bucle (`paginar.ts`; huérfanos, horas, informe por canal, bitácora, mantenimiento). Ya nos mordió tres veces.
- `audit()` escribe **siempre con service role** (la tabla no tiene política de insert para usuarios).
- Lint: una consulta a Supabase fuera de `lib/db` es error en `routes/` y en todo `lib/` (`eslint.config.mjs`).

### 2.4 Base de datos (Supabase)

Todas las tablas de negocio llevan `tenant_id` y RLS (`auth_tenant_id()` desde el JWT). Excepciones: `tenants` (la
raíz) y dos tablas de sistema globales, `limites` (contadores de límite de peticiones) y `cron_runs` (registro de
jobs), que no tienen `tenant_id`: tienen RLS activo y ninguna política, así que solo las toca el backend con service
role. La lista completa de tablas y columnas está en el [esquema](./esquema.md). Las que importan:

| Grupo | Tablas |
|---|---|
| Identidad | `tenants`, `usuarios`, `invitaciones`, `api_keys`, `oauth_clients/codes/tokens`, `mesas`, `integracion_credenciales` |
| Backlog | `clientes`, `proyectos`, `requerimientos`, `plantillas`, `plantilla_bloques/tareas`, `tipos_pieza`, `recurrencias`, `proyecto_borradores` |
| Cumplimiento | `reprogramaciones`, `reprocesos`, `bitacora` |
| Rituales | `semanas`, `senales`, `acuerdos`, `actas` |
| KPIs y evolutivo | `kpi_definiciones`, `kpi_mediciones`, `aprobacion_eventos` (rondas de revisión), `daily_snapshots`, `weekly_snapshots` |
| Integración | `horas` (timesheet), `basecamp_huerfanos`, `mapeo_servicios` (PrometIO), `notificaciones` |
| Agentes / IA | `agent_plans` (preview+confirm), `ia_generaciones` (caché por hash de prompt), `portal_resumenes` |
| Portal | `portal_pines` (PIN con scrypt, sin políticas) |
| Sistema | `limites`, `cron_runs` |
| Trazabilidad | `audit_log` (alimenta Auditoría, Día a día, Entradas desde Basecamp) |

Vistas: `v_requerimientos_metricas` (atraso, sin movimiento, veces reprogramado/reproceso, planificación),
`v_proyectos_avance`.

Triggers relevantes:
- `enforce_visibilidad_monotonica` (regla 2: nunca abrir visibilidad) y `requerimientos_visibilidad_insert`
  (una tarea sin plantilla nace oculta, salvo que la cree alguien de gestión).
- `requerimientos_before_insert/update` (fecha original, `completado_at`, planificación automática).
- `requerimientos_limitar_colaborador` (columnas que un colaborador puede cambiar) y `usuarios_proteger_columnas`
  (rol, activo, tenant y otros campos solo los cambia admin o service role).
- `requerimientos_registrar_aprobacion` (eventos de aprobación para los KPIs).
- `proyectos_recalcular_estado` (proyecto completado cuando todas sus tareas lo están), `ensure_semana`,
  `handle_new_auth_user` (alta solo con correo confirmado desde la migración 26).

Funciones RPC transaccionales (migración 29): `crear_lote` (proyectos y tareas del Builder y del import CSV en una sola
transacción) y `quitar_acceso`, que la migración 30 reemplazó por `salida_colaborador` (reparte por tarea,
proyecto, mesa, acuerdo y recurrencia; ver [Cuando alguien se va](./20-salida.md)). Límites de
peticiones: `limite_sumar`, `limite_estado`, `limites_limpiar` (migración 28).

Migraciones en `backend/supabase/migrations/`, numeradas `YYYYMMDD0000NN_nombre.sql` (hoy 01–31).
**Regla operativa:** todo SQL se entrega como archivo secuencial y lo corre Luis en el SQL editor
de Supabase (el conector MCP perdió permisos de SQL el 07/09). Procedimiento en
[Aplicar una migración](./operacion.md#aplicar-una-migracion).

---

## 3. Integraciones

### 3.1 Basecamp (`src/lib/basecamp/`)

| Archivo | Rol | Zona de revisión |
|---|---|---|
| `client.ts` | Cliente HTTP: OAuth refresh, throttle, paginación (`requestAll`), extractores "safe" que solo devuelven campos permitidos (`listTodosSafe`, `timesheetSafe`, `listPeopleSafe`) | — |
| `oauth.ts` | Flujo OAuth y refresh de tokens | — |
| `credenciales.ts` | Lee y guarda los tokens en `integracion_credenciales` (solo service role) | — |
| `sync.ts` | Webhook: `completed`, `completed_at`, `due_on`, `assignee_ids`, papelera/archivado. El webhook aplica el estado del to-do **vivo** (lo vuelve a leer en Basecamp), no el del payload. **Nunca extrae texto** (`sync.test.ts` lo garantiza) | — |
| `reconcile.ts` | Polling cada 30 min: converge `completed` desde Basecamp y reenvía `due_on` desde BackIO (regla 3), máximo 25 fechas por corrida, cada una auditada | — |
| `importar.ts` | Sincronización de estructura: listas → proyectos, grupos → bloques, to-dos → requerimientos (solo título, excepción D1), renombres, movimientos, responsables, eliminados. Corre cada 15 min y, para un to-do nuevo, también desde el webhook en segundos | — |
| `decisiones.ts` | Reglas puras de la importación: clasificar un to-do, qué cambió, fechas de un proyecto nuevo | — |
| `recorrer.ts` | Recorre los to-dos de un proyecto y mapea responsables de Basecamp a usuarios | — |
| `webhooks.ts` | Registra y actualiza el webhook de cada cliente (y enmascara el secreto en los logs) | — |
| `huerfanos.ts` | Detector manual de to-dos sin requerimiento (ya no corre por cron desde el 23/09) | — |
| `write.ts` | Escritura a producción real: crear listas/grupos/to-dos (máximo 50 por operación sin confirmación), `pushDueDate`, `reabrirTodo` | **Sí (CLAUDE.md)** |

Lecciones incorporadas al código (ver `docs/04-basecamp.md`):
- `PUT` sobre un to-do es reemplazo total → `updateTodo` lee el to-do y reenvía todos los campos.
- El reporte de timesheet ignora `bucket_id` → una sola llamada y atribución por `bucket.id` de cada entrada.
- Menciones en mensajes: `attachable_sgid` de `people.json` → `<bc-attachment content-type="application/vnd.basecamp.mention">`.

### 3.2 PrometIO (`routes/webhooks/prometio.ts`, `docs/08`)
Webhook firmado con `PROMETIO_WEBHOOK_SECRET` (`X-Prometio-Signature` y timestamp firmado). Comparte `cliente_id`.
Crea cliente/proyecto desde una cotización.

### 3.3 Anthropic (`src/lib/ia/`)
`index.ts` → `generarTexto()` con `thinking` desactivado, caché en `ia_generaciones` por hash de
prompt+modelo, errores traducidos (`traducirErrorIA`). Redactores: `daily.ts` (apertura/cierre en
markdown simple, que `markdownBasico` de `lib/mcp/publish.ts` convierte a HTML), `weekly.ts` (formato
NARRATIVA/AGENDA en texto plano), `informe.ts`, `brief.ts` y `recordatorio.ts`. **La IA redacta; una persona
publica** (`docs/15-ia.md`). Sin `ANTHROPIC_API_KEY`, las funciones de IA se ocultan.

### 3.4 MCP Server (`src/lib/mcp/`, `routes/mcp.ts`)
Herramientas de lectura y de escritura con preview+confirm (`agent_plans`, `plan_id` de 15 min, un
solo uso). `publish.ts` arma el HTML de dailies, actas e informes que van a Basecamp. Alerta si una
API key hace más de 20 escrituras en 5 min (`audit.ts`).

### 3.5 Observabilidad y abuso

- **Logger** (`lib/logger.ts`): una línea JSON por evento en producción, con nivel (`debug`, `info`, `warn`,
  `error`; `LOG_LEVEL`). Es el único lugar del backend que usa `console.*`. Nunca recibe payloads, tokens ni datos
  del cliente.
- **Sentry** (`lib/sentry.ts` en el backend, `frontend/lib/sentry.ts` e `instrumentation*.ts` en el frontend):
  opcional, solo si hay DSN. No envía cookies, cabeceras, cuerpos ni datos del usuario, y redacta las rutas con
  secretos.
- **Límite de peticiones** (`lib/limite.ts`): contadores en Postgres (`limites`), que sobreviven reinicios. Lo usan
  el PIN del portal, el registro OAuth, el resumen del portal y la recuperación de contraseña. Si la base no
  responde, cae a un contador en memoria.
- **Turnstile** (`lib/turnstile.ts`, `frontend/components/Turnstile.tsx`): captcha en login y recuperar
  contraseña, activo solo si están las claves.

---

## 4. Lo que corre solo (`src/lib/jobs.ts`, activo con `ENABLE_INTERNAL_CRON=1`)

Todas las tareas programadas están en una sola tabla, `JOBS` de `lib/jobs.ts`. La recorren el scheduler interno
(`lib/scheduler.ts`, un tick por minuto) y los disparadores externos de `/api/cron`. Cada ejecución reclama su ventana
en `cron_runs (job, ventana)`, una fila única, así que dos procesos no repiten el mismo job; dentro del proceso, el
scheduler tampoco lanza un job que sigue en curso. Al terminar se guarda `ok` y un resumen en `detalle` (solo conteos,
nunca texto de Basecamp). Todos usan `serviceClient()` con `origen: 'cron'`.

El vigía (`lib/vigia.ts`) corre cada hora como un job más. Si un job de hora fija no corrió en su ventana o uno
periódico lleva tres intervalos sin correr, deja el error en el log y en Sentry y manda un correo a las personas
admin, una vez por problema. El estado de cada tarea se ve en **Admin → Servicios**.

La tabla de horarios y qué hace cada tarea está en [Operación](./operacion.md#lo-que-corre-solo).

---

## 5. Frontend (Next.js 15.5, React 19, App Router)

```
frontend/
├── middleware.ts            redirige a /login sin sesión; deja pasar estáticos, /p (portal), /auth y /oauth;
│                            arma la CSP con nonce por respuesta ('strict-dynamic')
├── instrumentation.ts, instrumentation-client.ts   arranque de Sentry en servidor y navegador
├── app/
│   ├── (app)/               área interna: layout con Sidebar (grupos plegables) y páginas
│   │   ├── backlog/         tabla estilo Monday: filtros en URL, columnas fijas, celdas editables
│   │   ├── proyectos/, daily/, weekly/, personas/, dia-a-dia/, huerfanos/ (Entradas Basecamp)
│   │   ├── dashboard/, kpis/, evolutivo/
│   │   ├── informes/        mensuales, por canal, estatus por cliente
│   │   └── admin/           clientes, mesas, usuarios, plantillas, tipos de pieza, recurrencias,
│   │                        integraciones, api-keys, servicios (salud y tareas programadas), auditoría, kpis
│   ├── p/[token]/           portal del cliente (público por token)
│   ├── auth/, login/, oauth/ (consentimiento de agentes)
├── components/
│   ├── backlog/             BacklogTable, Celdas (CeldaSelect/Owners/Fecha/Texto), HistorialReq,
│   │                        Bitacora, MotivoReprogramacion, RecordatorioIA
│   ├── kpis/                tablero de KPIs por persona y equipo
│   ├── Sidebar.tsx, VistaCliente.tsx, Turnstile.tsx, ui/, dashboard/, informe/
└── lib/
    ├── api.ts / api.server.ts   fetch al backend con el JWT de Supabase (cliente / servidor)
    ├── me.server.ts / useMe.ts  usuario actual y permisos de UI (`puedeEscribir`)
    ├── useIA.ts                 si la IA está configurada (los botones de IA solo aparecen si sí)
    ├── useAvisosCarga.ts        avisa en pantalla cuando falla una carga secundaria
    ├── url.ts                   validación de enlaces (rutas internas, Basecamp solo https)
    ├── sentry.ts                filtro de datos antes de enviar a Sentry
    ├── orden.ts, format.ts      orden del backlog; fechas en America/Guayaquil
    └── supabase/                clientes de Supabase para browser y server components
```

Convenciones: los permisos de UI solo esconden; **el backend es el que decide**. `localStorage`
únicamente para preferencias (grupos del menú, filtros como respaldo, última mesa del daily), nunca
datos de negocio. Fechas en UTC en la base, se muestran en Guayaquil.

---

## 6. Pruebas

Tres suites de `vitest` (shared, backend, frontend) que corren en el CI en cada push. Por área:

| Área | Dónde |
|---|---|
| Frontera cliente: lo que sale al portal nunca lleva campos internos | `shared/src/__tests__/sanitize.test.ts`, `backend/src/__tests__/portal.test.ts` |
| Regla 1: el webhook y la importación no extraen texto de Basecamp | `backend/src/lib/basecamp/sync.test.ts` |
| Integración con Basecamp (con cliente simulado) | `importar_basecamp.test.ts`, `reconcile.test.ts`, `webhook_basecamp_verificado.test.ts`, `basecamp_descripcion.test.ts` |
| Seguridad de las auditorías | `seguridad_auditoria.test.ts`, `notificaciones_destino.test.ts`, `auth_publico.test.ts` |
| Permisos y edición de tareas | `rutas_actualizar_y_acceso.test.ts`, `actualizar_requerimiento.test.ts`, `mcp_requerimientos.test.ts` |
| Jobs y vigía | `jobs.test.ts`, `vigia.test.ts` |
| KPIs, evolutivo y cumplimiento | `kpis.test.ts`, `evolutivo.test.ts`, `a_tiempo_coherente.test.ts` |
| PrometIO | `webhook_prometio.test.ts` |
| Rituales y publicación | `signals.test.ts`, `daily_publish.test.ts`, `daily_formato.test.ts` |
| Builder, importación CSV y transacciones | `plan.test.ts`, `import.test.ts`, `lote.test.ts`, `plantilla_desde_proyecto.test.ts` |
| Infraestructura | `logger.test.ts`, `openapi.test.ts`, `validacion_errores.test.ts`, `fechas_locales.test.ts` |
| Frontend | `frontend/lib/__tests__/` (cliente HTTP y validación de enlaces) |

Las pruebas de Basecamp usan un cliente simulado. Faltan las de integración contra un proyecto sandbox real (§8).

---

## 7. Despliegue y operación

| Pieza | Dónde | Cómo se despliega |
|---|---|---|
| Backend | Railway, proyecto `protective-dream`, servicio `@backio/backend`, entorno `production` | Automático en cada push a `main` (Dockerfile). Logs: `railway logs -p protective-dream -s "@backio/backend" -e production --lines 300` |
| Frontend | Vercel, `backio.vercel.app` | Automático cuando el CI de `main` pasa (`.github/workflows/deploy-frontend.yml`, requiere `VERCEL_TOKEN`). Manual: `vercel deploy --prod` desde la raíz |
| Base + Auth | Supabase, proyecto `gckjyjvqvdfayjrtfbmj` | Migraciones a mano en el SQL editor |
| Correo | Resend (`lib/notificaciones`) | — |
| Errores | Sentry, org `geeksec` | — |

Detalle en [Despliegue](./12-despliegue.md). CI: `.github/workflows/ci.yml` (audit de dependencias de producción,
typecheck, lint, tests, build del frontend, referencia de la API al día y build de la documentación); Dependabot propone actualizaciones semanales.

Variables de entorno: la fuente es `backend/.env.example` y `frontend/.env.example`, con un comentario por
variable. El backend valida las suyas con zod al arrancar (`src/config/env.ts`).

Scripts operativos en `backend/scripts/` (se corren en local contra producción con el `.env`; reglas en
`backend/scripts/README.md`):

- Diagnóstico, solo lectura: `audit_resumen.ts`, `diag_asignados.ts`, `diag_informe_canal.ts`,
  `sin_owner_mapeable.ts`.
- Generadores: `gen_tipos_db.ts` (detrás de `db:types`) y `gen_docs_api.ts` (detrás de `docs:api`).

Los que hablan con Basecamp **requieren `BASECAMP_ACCOUNT_ID` en el entorno**.

Las reparaciones de datos ya no son scripts: están en **Admin → Mantenimiento** (`lib/mantenimiento.ts`,
`/api/v1/admin/mantenimiento`). Cada tarea se revisa primero sin tocar nada; al aplicar, el backend vuelve a calcular y
ejecuta solo lo que la persona marcó y sigue haciendo falta, y deja cada cambio en `audit_log`
(`mantenimiento_<tarea>`). Las que escriben en Basecamp aplican como máximo 50 to-dos por vez.

---

## 8. Deuda técnica conocida (priorizada)

Actualizada el 11/10/2026, al cerrar la auditoría externa (ver `HARDENING-CHANGELOG.md`).

1. **Sin staging.** Todo cambio va a producción. Acción: rama de Supabase + proyecto Basecamp sandbox
   (ya existe el cliente de pruebas "Acme EC S.A.S", proyecto 48775530).
2. **Tests de integración con Basecamp** sobre el sandbox: actualizar fecha sin perder asignados,
   timesheet, importación, papelera.
3. **Portal:** mostrar notas de bitácora `visible_cliente` (toca `lib/visibility/`, revisión humana).


Resuelto en la auditoría del 10/10: CI en cada push (typecheck, lint, tests, build y `pnpm audit`), tipos generados de
Supabase (`pnpm --filter @backio/backend db:types`), jobs en una sola tabla con registro. Después (11/10): vigía de jobs
(`lib/vigia.ts`: correo a admin y Sentry si una tarea programada no corre; estado en Admin → Servicios) y deploy
automático del frontend (`.github/workflows/deploy-frontend.yml`, con el secreto `VERCEL_TOKEN`). Reparaciones de datos
en Admin → Mantenimiento en lugar de scripts locales, y todas las consultas de `lib/` movidas a `lib/db` (la regla de lint
pasó a error).

---

## 9. Dónde mirar cuando algo falla

El recorrido completo, síntoma por síntoma, está en [Operación](./operacion.md). Atajos:

| Síntoma | Primer lugar |
|---|---|
| Una tarea programada no corrió o terminó mal | Admin → Servicios y la tabla `cron_runs`; en los logs de Railway, las líneas `[jobs] <job> …` |
| Un cambio en Basecamp no se ve en BackIO | `cron_runs` del job `estructura`, luego `audit_log` acción `basecamp_importar` del cliente. Logs: `[jobs] estructura …` y `[webhook basecamp] …` |
| Una fecha de BackIO no llegó a Basecamp | `audit_log` acción `reprogramar`; si quedó desfasada, `reconcile.ts` la reenvía en la siguiente corrida (máximo 25 por corrida) y deja `basecamp_fecha_reenviada` |
| Asignados desaparecen en Basecamp | `client.ts:updateTodo` debe reenviar `assignee_ids` (incidente 22/09 en `docs/04`) |
| La IA da error | `traducirErrorIA` en `lib/ia/index.ts`; el mensaje llega tal cual a la UI |
| Un usuario no ve algo | Primero `requireScope` de la ruta, luego la política RLS de la tabla |
| Horas raras por cliente | `sincronizarHoras`: atribución por `bucket.id` de cada entrada |
| Un error sin pista clara | Sentry (org `geeksec`), proyectos del backend y del frontend |
