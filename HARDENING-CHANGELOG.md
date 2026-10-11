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
