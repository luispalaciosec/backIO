# Endurecimiento de BackIO · auditoría del 10/10/2026

Fuente: `~/claude-projects/auditorias/2026-10-10/` (`backIO.md`, `backIO-checklist20.md`, `backIO-basura-calidad.md`,
`backIO-SUPERHERO-PROMPT.md`), auditada sobre el commit `f2e30e2`. Se trabaja por olas en `main`; cada ola se
despliega con typecheck y tests en verde. Las migraciones van a revisión de Luis antes de aplicarse.

Estados: **hecho** (en producción y verificado) · **parcial** · **pendiente-humano** (depende de un panel externo o de
una acción de Luis) · **pendiente** (ola futura).

## Ola 0 · Urgentes

| Hallazgo | Estado | Archivos | Verificación |
|---|---|---|---|
| B1 · CORS sin `PUT` (plantillas, tipos de pieza, definiciones y mediciones de KPI no guardaban) | hecho | `backend/src/app.ts` | Test de preflight (falla con el código anterior); preflight `OPTIONS` contra Railway después del deploy |
| B2 · El scheduler podía tumbar el proceso | hecho | `backend/src/lib/scheduler.ts`, `backend/src/index.ts` | Cada job captura su error; el tick por minuto tiene `.catch`; handlers globales de `unhandledRejection` y `uncaughtException`. Typecheck |
| S13 · El portal devolvía el mensaje de error interno | hecho | `backend/src/routes/portal.ts` | Test: el resumen responde 503 con mensaje fijo y sin el texto interno |
| S14 · Los 5xx de base devolvían el texto de Postgres | hecho | `backend/src/app.ts` | En producción, `Error interno` si `status >= 500`; el detalle queda en el log |
| S15 · Tres enlaces «Ver en Basecamp» sin `hrefExterno` | hecho | `DailyPublicar.tsx`, `informes/page.tsx`, `WeeklyActions.tsx` | Typecheck del frontend |
| B11 · La alerta de escritura masiva de API keys nunca se enviaba | hecho | `backend/src/lib/db/audit.ts` | Usa `notificar()` a admin y operaciones (antes: insert perezoso sin `await` y sin destinatario) |
| B13 · La paginación de horas ignoraba errores | hecho | `backend/src/lib/horas.ts` | `throwIf(error)` en cada página |
| [PENDIENTE-HUMANO] Revisar en el navegador que guardar una plantilla y una medición de KPI funciona | pendiente-humano | — | — |

## Ola 1a · Seguridad, solo código

| Hallazgo | Estado | Archivos | Verificación |
|---|---|---|---|
| S1 · Secreto del webhook y token del portal en los logs | hecho | `backend/src/lib/log.ts`, `backend/src/app.ts` | Logger propio que redacta `/api/webhooks/basecamp/*`, `/api/portal/*` y toda query string. Test de `redactarRuta` |
| S1 · Rotar `BASECAMP_WEBHOOK_SECRET` tras el deploy | hecho (Luis, 10/10) | Railway + Admin → Clientes → «Actualizar webhooks» | 15 webhooks actualizados, 0 registrados, 0 errores. Logs de Railway ya sin secretos en las rutas |
| S3 · Un colaborador veía desempeño, horas y correo del equipo | hecho | `routes/v1/personas.ts`, `routes/v1/horas.ts`, `lib/auth/roles.ts`, `frontend/components/Sidebar.tsx` | Tests: colaborador ve solo su fila sin correo y solo sus horas por persona; gestión ve todo. «Personas» oculto en el menú del colaborador |
| §3.6 · Permisos inline dispersos | hecho | `lib/auth/roles.ts` (`esColaborador`, `esColaboradorHumano`, `esGestion`), `shared/src/types.ts` (`puedeEscribir`), `requerimientos.ts`, `actividad.ts`, `me.server.ts`, `Sidebar.tsx` | Mismo significado que antes en cada sitio; typecheck y suite completa |
| S4 · Fallback de credenciales de Basecamp a `tenants.config` | hecho | `lib/basecamp/credenciales.ts` | Solo `integracion_credenciales`; nunca se escriben tokens en `tenants` |
| S5 · Botón del correo con ruta inyectable | hecho | `lib/notificaciones/index.ts`, `lib/validacion.ts`, requerimientos/plantillas/proyectos, `lib/builder/import.ts` | Marca neutralizada al encolar, se lee la última y lista blanca de secciones; títulos de una sola línea. Tests. Sin migración (se descartó la columna `ruta`) |
| S6 / M13 · Consentimiento con el nombre de la URL | hecho | `routes/oauth.ts` (`GET /oauth/client/:id`), `lib/oauth/index.ts`, `frontend/app/oauth/consent/page.tsx` | Nombre, hosts y scopes vienen del servidor; «Autorizar» solo si el host está registrado. Esquema zod en registro, token y revoke. Tests |
| S6 · Rate limit del registro dinámico | pendiente | Ola 3 (rate limit persistente) | — |
| S7 · Doble publicación de actas | hecho | `lib/mcp/publish.ts` | Reserva atómica (`publicado_at is null`) antes de Basecamp y se libera si falla. Se mantiene el diseño de docs/07 (decisión de Luis) |
| S8 · Rotación de refresh token no atómica | hecho | `lib/oauth/index.ts` | Update condicional; reutilización ⇒ se revocan los tokens vivos de ese cliente y usuario |
| S9 · `confirm_plan` consumía antes de verificar | hecho (1a + 1b) | `lib/mcp/plans.ts` (`verPlan`), `lib/mcp/server.ts`, migración 27 | Scope antes de consumir; el plan solo lo confirma la misma API key o el mismo usuario (`agent_plans.usuario_id`) |
| S10 · `payload_url` con el secreto | hecho | `lib/basecamp/webhooks.ts` | `enmascararPayloadUrl` en registrar y diagnosticar |
| S12 · `establecer-clave` aceptaba `#access_token` | hecho | `frontend/app/auth/establecer-clave/page.tsx` | Solo `token_hash` (invite/recovery) o `code` PKCE; al cambiar la clave se cierran las otras sesiones |
| Punto 13 · `cliente` de `/plantillas` en un filtro `.or()` | hecho | `routes/v1/plantillas.ts` | Exige uuid. Test |
| Punto 14 · Sin límite de tamaño del cuerpo | hecho | `app.ts` | `bodyLimit` 1 MB general y 2 MB en bulk. Test 413 |
| M14 · `pushDueDate` sin tope en la reconciliación | hecho | `lib/basecamp/reconcile.ts` | Máximo 25 fechas por corrida, cada una auditada |

## Ola 1b · Seguridad con migración 27

| Hallazgo | Estado | Archivos | Verificación |
|---|---|---|---|
| Migración 27 | hecho | `backend/supabase/migrations/20261010000027_seguridad_auditoria_1010.sql` | Aplicada por Luis; columnas y tabla comprobadas por la API con service role |
| S2 · RLS de `clientes` y `mesas` más amplia que la API | hecho | migración 27; `lib/basecamp/importar.ts` | Escritura por PostgREST solo admin; la marca de importación pasa a service role para no romper a operaciones/ejecutivas |
| S9 · Plan atado al usuario | hecho | `lib/mcp/plans.ts`, `lib/mcp/server.ts` | `usuario_id` del creador guardado y comparado en `confirm_plan` |
| S11 · Keys de perfil cliente sin cliente | hecho | `lib/auth/middleware.ts`, `routes/v1/admin.ts`, `lib/mcp/server.ts`, `admin/api-keys/page.tsx` | El cliente es obligatorio al crear la key; `get_project_status` solo devuelve proyectos de ese cliente. Test. No había keys de ese perfil activas |
| M3 · PIN del portal en claro | hecho | `lib/portal/pin.ts` (scrypt + sal), `routes/portal.ts`, `routes/v1/clientes.ts`, `admin/clientes/page.tsx` | Hash en `portal_pines` (sin políticas); el portal compara contra el hash; Admin solo indica si hay PIN y permite cambiarlo o quitarlo. Tests de hash y del portal |
| M3 · Migrar los PIN existentes | hecho | `POST /api/v1/clientes/portal-pines/migrar`, `migrarPinesEnClaro` | Ejecutada el 10/10: los 17 clientes tenían la clave `portal_pin` en config pero vacía (el formulario guardaba `null`), así que no había ningún PIN real que migrar; se limpió la clave. Quedan 0 PIN en claro |

## Acciones de Luis (10/10)

| Acción | Estado | Verificación |
|---|---|---|
| Rotar `BASECAMP_WEBHOOK_SECRET` y actualizar los 15 webhooks | hecho | Mensaje de BackIO: 15 actualizados, 0 errores |
| Supabase: registro público apagado y «Confirm email» activo | hecho | `/auth/v1/settings`: `disable_signup: true`, `mailer_autoconfirm: false` |
| Supabase: límites de Auth (sign-in, refresh, verificación) | hecho (Luis) | Configurados en el panel; no se exponen por API |
| Sentry: proyectos `backio-frontend` y `backio-banckend` creados | hecho (Luis) | Faltan los DSN para la Ola 7 |
| Reautorizar Basecamp (tokens nuevos) | hecho | Conectado 10/10 18:20; credenciales en `integracion_credenciales` (actualizada 23:20 UTC) y ningún token en `tenants.config` |

## Ola 2 · Dependencias (checklist punto 20)

| Hallazgo | Estado | Archivos | Verificación |
|---|---|---|---|
| Backend: MCP SDK 1.30 (GHSA-6qxp-vccf-f47h), Hono 4.13.5, proxy-addr, fast-uri, ip-address | hecho | `backend/package.json`, `package.json` (`pnpm.overrides`) | MCP SDK 1.32.1, Hono 4.13.13; test nuevo de `initialize` + `tools/list` del MCP; deploy y `/health` 200 |
| Frontend: Next 14.2.35 (2 críticas, 8 altas), postcss, source-map-js | hecho | `frontend/package.json`, `lib/supabase/server.ts`, `(app)/layout.tsx`, `lib/api.server.ts`, `proyectos/[id]`, `daily`, `p/[token]`, `next.config.mjs` | Next 15.5.27 + React 19; `cookies()`, `params` y `searchParams` asíncronos; `outputFileTracingRoot`; postcss y source-map-js por override. Build OK; login, recuperar y consentimiento revisados en el navegador sin errores |
| `pnpm audit --prod` | hecho | — | De 34 vulnerabilidades (3 críticas, 12 altas) a **0** |
| CI con auditoría y Dependabot | hecho | `.github/workflows/ci.yml`, `.github/dependabot.yml` | `pnpm audit --prod --audit-level=high` en cada push y PR; Dependabot semanal (npm) y mensual (actions) |
| Probar en producción las pantallas con sesión (backlog, daily, KPIs, proyectos) | hecho (Luis, 10/10 19:00) | — | Rollback inmediato si algo falla: `vercel rollback https://backio-p0ys99oui-luis-palacios-projects-1f891ccb.vercel.app` |

## Ola 3 · Headers, bots y límite de peticiones (checklist 9, 11, 12, 18, 19)

| Hallazgo | Estado | Archivos | Verificación |
|---|---|---|---|
| M2 / punto 18 · CSP completa en el frontend | hecho | `frontend/middleware.ts`, `app/layout.tsx`, `next.config.mjs` | Nonce por respuesta + `'strict-dynamic'`; `connect-src` solo backend y Supabase; `object-src 'none'`, `base-uri`, `form-action`, `frame-ancestors 'none'`. Build de producción local: 14/14 scripts con nonce, `eval` bloqueado, sin violaciones en consola |
| Punto 18 · CSP en el backend | hecho | `backend/src/app.ts` | `default-src 'none'; frame-ancestors 'none'`. Test |
| Punto 9 · Robo de sesión por XSS | parcial | — | Mitigado por la CSP (la sesión de Supabase sigue siendo legible desde JS por diseño) |
| Punto 11 · Límite de peticiones persistente | hecho | `backend/src/lib/limite.ts`, `lib/ip.ts`, `routes/oauth.ts`, `routes/auth_publico.ts`, `routes/portal.ts`, `routes/mcp.ts`, `lib/scheduler.ts` | `/oauth/register` 10/h, `/oauth/token` y `/revoke` 60/5 min por IP; recuperar 10/15 min por IP y 1/min por correo; resumen del portal 10/h por enlace; PIN y MCP pasan a la misma tabla. Sin la migración 28 usa memoria (como antes). Tests |
| Migración 28 (`limites`, `limite_sumar`, `limite_estado`, `cron_runs`) | hecho | `backend/supabase/migrations/20261010000028_limites_y_cron_runs.sql` | Aplicada por Luis; probada por la API: suma, bloquea al pasar el máximo y la consulta sin sumar coincide. Los límites ya son persistentes |
| Punto 12 · Captcha (Turnstile) | hecho (código) | `frontend/components/Turnstile.tsx`, login, recuperar; `backend/src/lib/turnstile.ts` | Activo solo con claves; sin claves los formularios funcionan igual. Test. En `/oauth/register` no aplica (lo llaman clientes MCP automáticos): queda el límite por IP |
| Punto 12 · Claves de Turnstile y captcha en Supabase | hecho (Luis, 10/10) | Vercel `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, Railway `TURNSTILE_SECRET_KEY`, Supabase → Attack Protection | Frontend redesplegado con la clave; el widget aparece en el login sin violaciones de CSP (formato compacto en pantallas < 300 px). Luis inició sesión con el captcha sin problemas |
| Punto 19 · URLs públicas https en producción | hecho | `backend/src/config/env.ts` | Aviso en el log si alguna no es https o si `FRONTEND_URL` incluye orígenes locales |
| `FRONTEND_URL` de Railway incluía `http://localhost:3000` | hecho (Luis, 10/10) | Railway → Variables | Solo `https://backio.vercel.app`; un preflight desde `http://localhost:3000` ya no recibe permiso CORS |

## Ola 4 · Calidad I: basura, formato y utilidades compartidas

| Hallazgo | Estado | Archivos | Verificación |
|---|---|---|---|
| A.1 · 13 scripts gastados (incluido `verificar_put.ts`, `PUT` crudo a Basecamp) | hecho | `backend/scripts/*`, `backend/scripts/README.md` | Borrados; el README ya no dice que `verificar_put.ts` no escribía y documenta `duplicados_sin_enlace.ts` |
| A.1 · Exports y locales muertos | hecho | `db/usuarios.ts`, `builder/import.ts`, `cumplimiento.ts`, `ia/index.ts`, `ia/informe.ts`, `basecamp/client.ts`, `basecamp/oauth.ts`, `mcp/server.ts`, `shared/src/types.ts`, `shared/src/api.ts`, `BacklogTable.tsx`, `admin/recurrencias`, `Step3Alcance.tsx` | `tsc --noUnusedLocals --noUnusedParameters` limpio en los tres paquetes |
| A.1 · Reexports de `lib/visibility/index.ts` | hecho | `backend/src/lib/visibility/index.ts`, `sanitize.ts` y `basecamp/write.ts` (formato) | Con visto bueno de Luis (`ab3ac3d`): solo quedan `sanitizeForClient` y `assertClientSafe`, los únicos que se importan |
| A.2 · `/cron/huerfanos` (detector retirado el 23/09) | hecho | `backend/src/routes/cron.ts` | Borrado |
| A.3 · `dotenv` no declarado | hecho | `backend/package.json` | devDependency |
| B14 · README con migraciones «01–20» y alerta de API keys dada por buena | hecho | `README.md`, `docs/18-seguridad.md` | Corregidos |
| B4 · «A tiempo» con el día UTC del cierre en cumplimiento y dashboard (KPIs restaba 5 h a mano) | hecho | `shared/src/fechas.ts` (`diaLocal`), `cumplimiento.ts`, `dashboard.ts` (usa `aTiempoOriginal`/`aTiempoVigente`), `kpis.ts`, `evolutivo.ts`, `personas.ts`, `informe_canal.ts` | `fechas_locales.test.ts`: un cierre a las 19:30 del día de entrega cuenta a tiempo; falla con el código anterior |
| B5 · «Hoy» en UTC (después de las 19:00 era mañana) | hecho | `basecamp/importar.ts`, `routes/v1/requerimientos.ts`, `horas.ts`; frontend `weekly`, `WeeklyActions`, `proyectos`, `Step2Brief`, `backlog` (fecha de pedido), `informes/estatus` | `hoyLocal()` de shared; `fechas.test.ts` (20:00 de Guayaquil sigue siendo hoy) |
| Bordes de día y mes en UTC en el informe mensual de IA | hecho | `ia/informe.ts` | `inicioDiaLocal`/`finDiaLocal`: el mes ya no deja fuera lo cerrado después de las 19:00 del último día |
| Utilidades de fecha y métrica duplicadas | hecho | `shared/src/fechas.ts` (`ZONA`, `diaLocal`, `hoyLocal`, `sumarDias`, `lunesDe`, `inicioDiaLocal`, `finDiaLocal`), `shared/src/metricas.ts` (`porcentaje`, `formatoFraccion`), `backend/src/lib/db/paginar.ts` | Quitadas las copias de `fechaLocal`, `sumarDias`, `diaGye`, `lunesDe`, `pct`, `paginar`, `hoyLocal` y los literales `-05:00`; `America/Guayaquil` solo vive en `ZONA` |
| Formato y lint (789 líneas de más de 200 caracteres) | hecho | `.prettierrc.json`, `.prettierignore`, `eslint.config.mjs`, `.git-blame-ignore-revs`, CI | Commit solo de formato (`4e1fe2a`, ignorado en `git blame`); `pnpm lint` en CI: catch vacío y `any` son error, consulta a Supabase fuera de `lib/db` es aviso (172, se mueven en la Ola 6). Quedan 19 líneas largas (textos y plantillas). Las zonas de revisión humana no se formatearon |
| Etiquetas de estado duplicadas; `describir` (CC 74) | hecho | `shared/src/etiquetas.ts`, `backend/src/lib/actividad.ts`, `frontend/lib/format.ts` | `describir` es una tabla de frases; comparado contra la versión anterior en 114 casos sin diferencias; `actividad_describir.test.ts` |

## Ola 5 · Calidad II: flujos únicos

| Hallazgo | Estado | Archivos | Verificación |
|---|---|---|---|
| B9 · Actualizar requerimiento con dos copias que divergían (REST y MCP) | hecho | `backend/src/lib/requerimientos/actualizar.ts` (`actualizarRequerimiento`, `validarActualizacion`, `ReglaError`), `routes/v1/requerimientos.ts` como adaptador, `CAMPOS_COLABORADOR` en shared (backend y backlog) | `actualizar_requerimiento.test.ts` (7): regla 3, daily sin responsable, colaborador, motivo, `pushDueDate` auditado si falla, reprocesos. El MCP (`plan_requirement_update` y `confirm_plan`) usa la misma función, con visto bueno de Luis: el preview ya rechaza lo que no se podrá aplicar |
| B10 · Jobs de calendario perdidos en un despliegue y repetidos con dos réplicas; scheduler y `/api/cron` duplicados | hecho | `backend/src/lib/jobs.ts` (tabla `JOBS`, `ejecutarJob`), `lib/db/cron_runs.ts`, `lib/scheduler.ts`, `routes/cron.ts`, `docs/17` §4 | `jobs.test.ts` (9): recuperación del tick perdido dentro de 2 h, sin disparar jobs viejos al arrancar, una sola ejecución por ventana con dos procesos, fallos registrados en `cron_runs` sin tumbar el proceso. Un solo `tenants()` |
| B3 · Errores de validación como objeto («[object Object]» en pantalla) | hecho | `backend/src/lib/validacion.ts` (`zValidator` con hook común, usado por las 14 rutas), `frontend/lib/api.ts` (`mensajeDeError`) | `validacion_errores.test.ts`: `error` es «Revisa: fecha_entrega, piezas» y el detalle por campo va aparte. El frontend también entiende el formato viejo |
| Cuatro copias del fetch del frontend; un 2xx no JSON se devolvía como `{}` | hecho | `frontend/lib/api.ts` (`pedir`), `api.server.ts` | `api`, `apiRaw`, `apiPortal` y `apiServer` son envoltorios del mismo núcleo: conserva 204, falla si la respuesta no es JSON, mensajes claros para 401 y 5xx |
| OpenAPI con esquemas copiados (sin `planificacion`, `clase`, `proactiva`) | hecho | `routes/openapi.ts` usa `crearRequerimientoSchema`, `actualizarRequerimientoSchema`, `crearProyectoSchema` y `crearAcuerdoSchema` exportados por sus rutas; respuesta `Requerimiento` completada | `openapi.test.ts` |
| MCP en un archivo de 694 líneas; la regla `lib/mcp/tools/*write*` de `CLAUDE.md` no cubría nada | hecho | `lib/mcp/server.ts` (arma el servidor), `comun.ts`, `tools/read.ts`, `tools/write_plans.ts`, `tools/write_actas.ts` (factoría para `generate_weekly_plan` y `generate_closing_minutes`), `tools/write_confirm.ts` | Con visto bueno de Luis. `tools/list` comparado antes y después por el protocolo MCP: 16 tools, 0 diferencias en nombre, descripción y esquema |

## Ola 6 · Calidad III: transacciones, Basecamp y tipos

| Hallazgo | Estado | Archivos | Verificación |
|---|---|---|---|
| B12 · Plantilla desde proyecto: ternario muerto y pesos con tareas excluidas (3 bloques iguales salían 1 %, 1 % y 98 %) | hecho | `backend/src/lib/builder/desde_proyecto.ts` (`bloquesDesdeProyecto`, pura), `routes/v1/plantillas.ts` | `plantilla_desde_proyecto.test.ts`: tres bloques iguales dan 33,4 / 33,3 / 33,3 y suman 100 |
| B6 · Importación de Basecamp: carrera webhook/cron con duplicados, corte en 1000 enlazados, reimportaba huérfanos ignorados | hecho | `lib/basecamp/importar.ts` (orquesta), `decisiones.ts` (puras: `clasificarTodo`, `cambiosDeEnlazado`, `filaDesdeTodo`, `fechasProyectoNuevo`, `marcasDeTitulo`), `recorrer.ts` (recorrido y mapa de usuarios, compartidos con `huerfanos.ts`), `lib/db/basecamp_import.ts`, `lib/candado.ts` | `importar_basecamp.test.ts` (8): el enlace a Basecamp va en el mismo INSERT y un duplicado (índice único) cuenta como ya enlazado; una importación por cliente a la vez; los ignorados no vuelven; enlazados paginados. Sin el flag `soloActualizar` (nadie lo usaba). Las marcas del título van en el INSERT (antes un UPDATE con error tragado). La fecha de pedido usa el día de Guayaquil |
| Cliente de Supabase sin tipos (`SupabaseClient` sin esquema) | hecho | `backend/scripts/gen_tipos_db.ts` (`pnpm --filter @backio/backend db:types`), `src/lib/db/database.types.ts`, `Db = SupabaseClient<Database>`, `FilaInsert`/`FilaUpdate` | Generado desde el esquema de PostgREST (43 tablas, 1 vista, relaciones por FK) sin depender de la CLI. Destapó un bug: el informe mensual filtraba por un estado «cerrado» inexistente, la consulta fallaba sin revisar el error y el valor cotizado salía en 0 (`ia/informe.ts`). También: `updateRequerimiento` ya no acepta campos que no son columnas, y la auditoría de «recuperar contraseña» toma el tenant de la misma consulta |
| B7 · Import CSV y Builder no transaccionales (proyectos huérfanos con portal token si fallaba una fila) | hecho | Migración 29 (`crear_lote`, `_insertar_fila`, SECURITY INVOKER: RLS y triggers aplican), `lib/db/lote.ts`, `routes/v1/requerimientos.ts` (bulk), `lib/builder/service.ts`; texto de la pantalla de importar ahora cierto | Aplicada por Luis el 11/10. En producción: un proyecto válido con una tarea inválida falla con 23502 y el proyecto no queda creado. `lote.test.ts` |
| B8 · «Quitar acceso» en pasos sueltos con errores tragados | hecho | Migración 29 (`quitar_acceso`, SECURITY DEFINER solo para service_role, filtra por tenant), `routes/v1/admin.ts` | En producción: anónimo recibe 42501 en `quitar_acceso` y `crear_lote`; usuario de otro tenant, P0002. Credenciales primero; si algo falla no cambia nada y la pantalla recibe el error. El bloqueo en Supabase Auth va después y su resultado se informa (`auth_error`) |
| Consultas a Supabase dentro de las rutas (38 en 9 archivos) | hecho | `lib/db/admin.ts` (nuevo), `tenants.ts` (nuevo), y funciones nuevas en `clientes.ts`, `usuarios.ts`, `proyectos.ts`, `requerimientos.ts`, `historial.ts`, `bitacora.ts`, `semanas.ts`, `audit.ts`; rutas `admin`, `requerimientos`, `clientes`, `proyectos`, `huerfanos`, `ia`, `auth_publico`, webhooks de Basecamp y PrometIO | 0 consultas en `routes/`; `eslint.config.mjs`: la regla es **error** en rutas y aviso en el resto de `lib` (115 por mover). De paso: «restaurar acceso» y el logo de PrometIO ahora filtran por tenant, y varias lecturas que ignoraban el error ya lo revisan |

## Ola 7 · Frontend, operación y documentación

| Hallazgo | Estado | Archivos | Verificación |
|---|---|---|---|
| Cargas que fallaban en silencio (`.catch(() => {})` en 16 lugares: filtros y columnas vacíos sin aviso) | hecho | `frontend/lib/useAvisosCarga.ts`, `components/ui/AvisoCarga.tsx`; backlog, dashboard, KPIs, informes, nuevo proyecto (y paso de alcance), auditoría, clientes, controles del portal | Cada fallo dice qué no cargó («No se pudo cargar las mesas…») con botón para reintentar. Solo queda silenciosa la celebración del backlog (decorativa) y el cierre de otras sesiones al fijar contraseña. `next lint` sin avisos, build OK |
| AntiSlop (backIO.md §4) | hecho salvo el daily | Prompts: `lib/portal/resumen.ts` (sin tríada ni «no es X, es Y»), `lib/ia/recordatorio.ts` (sin «qué se desbloquea», cierra con una pregunta concreta), `lib/ia/index.ts` (largo de frase variado; «avisa al administrador de BackIO»). Copys: KPIs sin «¡…! 🎉», weekly, portal («Pendiente de tu revisión»; el PIN incorrecto y el bloqueo por intentos ahora se dicen), errores sin jerga («Esta tarea se marca como completada en Basecamp», «Hay filas con errores; no se cargó ninguna…»), README sin `---` entre secciones | Los encabezados con emoji del daily que se publica en Basecamp se mantienen: es el formato del equipo y cambiarlo es decisión de Luis |
| Subtítulo falso de Integraciones («en la configuración del tenant») | hecho | `frontend/app/(app)/admin/integraciones/page.tsx` | Ahora dice dónde están de verdad: tabla aparte que solo lee el servidor (no se afirma cifrado: no lo están) |
| Logger con niveles y Sentry | hecho | `backend/src/lib/logger.ts` (`log.debug/info/warn/error`: JSON por línea en producción, `LOG_LEVEL`), `lib/sentry.ts` (solo si existe `SENTRY_DSN`; sin cabeceras, cookies, cuerpos, query ni usuario; URL redactada), 46 `console.*` reemplazados en 26 archivos, `pnpm.overrides` de `brace-expansion` (transitiva de Sentry) | `logger.test.ts`. **Hallazgo nuevo corregido:** el manejador de errores escribía `c.req.path` sin redactar, así que un 500 en el portal o en el webhook de Basecamp dejaba el token o el secreto en el log (el test falla con el `app.ts` anterior). `pnpm audit --prod` sin vulnerabilidades |
| Sentry en el frontend | hecho | `frontend/lib/sentry.ts`, `instrumentation-client.ts`, `instrumentation.ts`, `middleware.ts` (la CSP admite el host de ingesta solo si hay DSN) | Mismas reglas que el backend; la URL pierde el token del portal (`/p/[redactado]`) y toda query. Sin subir source maps (no hace falta token de Sentry): las trazas llegan minificadas. Build de producción probado en el navegador sin errores de consola |
| `.env.example` incompletos (faltaban 9 variables; la raíz listaba una que ya no existe) | hecho | `backend/.env.example`, `frontend/.env.example` (comentados: qué hace cada una y cuáles son opcionales), `.env.example` raíz como índice | Contrastados con todos los `process.env.*` del código y con `config/env.ts` |
| Documentación | hecho | `docs/README.md` (índice: qué responde cada documento), `docs/18-seguridad.md` (resumen de esta ronda), `docs/17` §8 (deuda actualizada), `README.md` (migraciones 01–29) | `docs/manual/` (9,5 MB) se queda donde está; si crece, conviene Git LFS |
| Páginas-dios del frontend | hecho (lo que pasaba el umbral) | `components/kpis/Kpis.tsx` (293 líneas, 5 componentes) → `comun.tsx`, `VistaEquipo.tsx`, `FichaPersona.tsx`, `DetalleKpi.tsx`, `useTableroKpis.ts` (Kpis.tsx reexporta: los importadores no cambian); backlog → `useCatalogosBacklog.ts` y `useFiltrosBacklog.ts` | Movimientos sin cambios de lógica: typecheck con `--noUnusedLocals`, `next lint` y build. Dashboard (158 líneas) y Nuevo proyecto (150) quedaron como están: ya cargan con `useAvisosCarga` y partirlos no reduce riesgo. **[PENDIENTE-HUMANO]** recorrer backlog (filtros en la URL, vista kanban) y KPIs en producción |
| Sentry activo en producción (11/10) | hecho | DSN cargados por Luis: `SENTRY_DSN` en Railway, `NEXT_PUBLIC_SENTRY_DSN` en Vercel (frontend redesplegado) | Evento de prueba del backend enviado con las variables de producción; desde el navegador, el envío a `…/api/4512234550657024/envelope/` respondió 200; la CSP de producción admite el host de ingesta. Los dos eventos de prueba se pueden resolver en Sentry |

## Ola 8 · Tests que faltan

| Hallazgo | Estado | Archivos | Verificación |
|---|---|---|---|
| Encabezados del daily escritos por la IA (podían variar) | hecho | `backend/src/lib/ia/daily.ts` (`SECCIONES_DAILY`, `armarDaily`) | Decisión de Luis (11/10): los emojis se quedan. La IA marca cada sección con `[[clave]]` y el código pone el título fijo, en orden, sin secciones vacías; si la IA no marca, se publica su texto. `daily_formato.test.ts` (5) |
| Reconciliación con Basecamp sin tests | hecho | `__tests__/reconcile.test.ts` (5) | Aplica `completed` de Basecamp; reenvía la fecha de BackIO si quedó desfasada y lo audita (regla 3); tope de 25 por corrida (M14); un to-do que falla no detiene al resto; cliente consultado una vez |
| Coherencia de «a tiempo» entre módulos | hecho | `shared/src/metricas.ts` (`cerradaATiempo`, única definición), usada por `cumplimiento.ts`, `kpis.ts` y `evolutivo.ts` (que aún comparaban por su cuenta) | `a_tiempo_coherente.test.ts`: cierre a las 19:30 del día de entrega es a tiempo y a las 00:30 del día siguiente es tarde, igual en cumplimiento (dashboard, personas, informes), evolutivo y KPIs |
| Webhook de PrometIO sin tests de eventos | hecho | `__tests__/webhook_prometio.test.ts` (7) | Firma inválida y timestamp viejo: 401 con rastro sin el cuerpo; empresa creada/actualizada con el mismo id (logo solo si viene); cotización aprobada crea solo un borrador (nunca un proyecto) con la plantilla sugerida y avisa a ejecutivas y operaciones; cliente nuevo antes del borrador; payload inválido 400 auditado; evento desconocido ignorado; cuerpo repetido procesado una vez |
| MCP: reglas de `actualizarRequerimiento` en preview y confirmación | hecho | `__tests__/mcp_requerimientos.test.ts` (4) | Por el protocolo MCP en memoria: sin motivo no hay plan; el preview pasa por `validarActualizacion` y no ofrece planes inaplicables; confirmar llama a la función común con `exigirMotivo` y el `plan_id` para auditoría; si la regla cambió, el agente recibe el motivo |
| Frontend sin tests | hecho | `frontend/vitest.config.mts`, `lib/__tests__/api.test.ts` (9), `lib/__tests__/url.test.ts` (5); `pnpm test` los corre en CI | Núcleo de fetch: 204, 2xx no JSON falla, error con estado y detalle, JSON con cabecera, token de sesión en `api`, PIN sin token en `apiPortal`; `mensajeDeError` (incluido el formato viejo de zod); `hrefExterno` solo https; `rutaInterna` rechaza otro origen y el truco del tabulador; `limpiarUrl` quita el token del portal y las query antes de Sentry |
