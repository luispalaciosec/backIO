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
