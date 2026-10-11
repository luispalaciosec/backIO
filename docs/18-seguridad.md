# 18 · Seguridad

> Revisado contra el código el 11/10/2026.

Registro de las tres revisiones de seguridad de BackIO: la revisión interna del 23/09/2026, la auditoría run-1
(28–30/09) y la auditoría externa del 10/10. Para cada una queda qué se encontró, qué se corrigió y qué sigue
pendiente. Las tablas del 23/09 están actualizadas con lo que se cerró después; la historia se conserva.

## Pendiente hoy

- **Rotar credenciales de Basecamp es una práctica manual.** Los tokens OAuth se renuevan reconectando la cuenta en
  Admin → Integraciones, y el secreto del webhook cambiando `BASECAMP_WEBHOOK_SECRET` y actualizando los webhooks
  ([cómo](./operacion.md#rotar-el-secreto-del-webhook-de-basecamp)). No hay rotación automática ni calendario.
- **Códigos OAuth en claro** (M13). Los códigos de autorización del MCP se guardan tal cual en `oauth_codes`
  (`lib/oauth/index.ts`). Son de un solo uso y con PKCE obligatorio, pero falta guardarlos como `sha256(code)`, como
  ya se hace con los tokens.
- **`logo_url` de PrometIO sin validar.** El webhook (`routes/webhooks/prometio.ts`) acepta cualquier texto y lo guarda
  si el cliente no tenía logo. Falta exigir una URL https.
- **`procesarPendientes` sin claim atómico** (`lib/notificaciones/index.ts`). Si coinciden el scheduler y un disparo
  externo de `/api/cron`, un correo puede salir dos veces.
- **Capturas del manual con datos reales** (M15) y **reparaciones por script** (M10): ver la tabla de medios.

## Revisión del 23/09/2026

Tres revisiones independientes sobre todo el código (backend: auth, RLS y API · integraciones,
webhooks e IA · frontend, secretos y dependencias). Cada hallazgo fue verificado leyendo el código.

### Estado

| Estado | Significado |
|---|---|
| ✅ Corregido | Código desplegado el 23/09 o después (se indica cuándo) |
| 🗄️ Migración 21 | Corregido en `20260923000021_seguridad_rls.sql`, aplicada por Luis el 23/09 (verificado: tokens en `integracion_credenciales`, `tenants.config` sin `basecamp`, sin URLs de webhook) |
| ⏳ Pendiente | Requiere decisión o trabajo aparte |

### Críticos

| # | Hallazgo | Estado |
|---|---|---|
| C1 | **Tokens OAuth de Basecamp legibles por cualquier usuario.** Vivían en `tenants.config`, columna visible por RLS para todo `authenticated`. Con el token se leen comentarios y adjuntos de todos los proyectos: la regla 1 quedaba rota por fuera de BackIO. | ✅ Código: nueva tabla `integracion_credenciales` (solo service role) con `lib/basecamp/credenciales.ts`. 🗄️ Migración 21 crea la tabla, mueve los tokens y los borra de `tenants.config`. ✅ El fallback al esquema viejo se quitó el 10/10 (S4) y Basecamp se reconectó ese día, con tokens nuevos. |
| C2 | **Escalada a admin.** La política `usuarios_update_self` dejaba que un usuario cambiara su propio `rol` por PostgREST. | 🗄️ Migración 21: trigger que protege `rol`, `activo`, `tenant_id`, `email`, `basecamp_user_id`, `capacidad_semanal` salvo admin o service role. |

### Altos

| # | Hallazgo | Estado |
|---|---|---|
| A1 | Secreto del webhook de Basecamp guardado en `clientes.config` (en la URL) y devuelto por la API a cualquier rol. Permitía forjar eventos `todo_completed`/`todo_trashed`. | ✅ Ya no se persiste la URL; `config` de clientes solo se devuelve a admin. 🗄️ Migración 21 borra las URLs guardadas. ✅ Secreto rotado y webhooks actualizados el 10/10 (S1) |
| A2 | `/api/cron/*` público si `CRON_SECRET` no estaba definida. | ✅ Fail-closed en producción y comparación en tiempo constante |
| A3 | API keys de perfil `cliente` podían usar la REST y ver títulos internos y toda la cartera. | ✅ Rechazadas fuera del MCP (que sí sanitiza) |
| A4 | Un token OAuth del MCP con scope mínimo pasaba `requireScope('admin')` si el dueño era admin. | ✅ Exención eliminada; OAuth nunca alcanza rutas admin |
| A5 | Colaborador podía editar cualquier columna de sus tareas por PostgREST, y por la API editar notas, reprogramaciones y reprocesos ajenos. | ✅ API: verificación de propiedad en bitácora (crear/borrar), reprogramaciones y reprocesos; un colaborador no publica notas al cliente. 🗄️ Migración 21: trigger que limita columnas y políticas de bitácora/reprogramaciones/reprocesos a gestión o dueño |
| A6 | **Next.js 14.2 sin parches** para 23 avisos (2 críticos, 8 altos; DoS y cache poisoning aplican al App Router). | ✅ Next 15.5.27 con React 19 (auditoría del 10/10) |

### Medios

| # | Hallazgo | Estado |
|---|---|---|
| M1 | Open redirect en `/login?next=` | ✅ Solo rutas internas |
| M2 | Sin cabeceras de seguridad en el frontend | ✅ `X-Frame-Options`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS. ✅ CSP completa con nonce por respuesta y `'strict-dynamic'`, armada en `frontend/middleware.ts` (10/10) |
| M3 | PIN del portal: sin límite de intentos, comparación no constante | ✅ `timingSafeEqual` y bloqueo de 15 min. ✅ Desde el 10/10: PIN con scrypt en `portal_pines`; bloqueo tras 8 fallos por enlace+IP o 30 por enlace, con contadores en Postgres (`limites`) |
| M4 | IDOR con service role en `guardarPlantilla` (regla 5) | ✅ Se verifica que el id sea del tenant; borrado de bloques filtrado por tenant |
| M5 | `visible_cliente=true` aceptado en el INSERT desde API/agente sin plantilla (regla 2 solo cubría UPDATE) | 🗄️ Migración 21: trigger `before insert` |
| M6 | Inyección de `ruta` en correos (`\n__ruta__:` dentro de un título) → botón «Abrir en BackIO» a un dominio ajeno | ✅ La ruta solo se acepta si es un path interno; título sin saltos de línea; `href` escapado |
| M7 | Scheduler sin lock: corridas solapadas duplicaban proyectos | ✅ Lock por job. 🗄️ Migración 21: índice único `proyectos(tenant_id, basecamp_todolist_id)`. Desde el 10/10 el lock es la fila única de `cron_runs (job, ventana)` más un set en memoria del scheduler para no lanzar un job que sigue en curso |
| M8 | Webhook PrometIO sin anti-replay | ✅ Ventana de ±5 min si viene `X-Prometio-Timestamp` y rechazo de cuerpos repetidos en 10 min |
| M9 | `esc()` no escapaba comillas y se usaba en atributos | ✅ |
| M10 | Scripts con `PUT` crudo a Basecamp y one-offs sin confirmación en el repo | ✅ `exp_*` eliminados; `scripts/README.md` con reglas. ⏳ Convertir reparaciones recurrentes en endpoints de admin |
| M11 | `ultimo_uso_at` de API keys nunca se actualizaba (builder sin `await`) | ✅ |
| M12 | «Entradas desde Basecamp» leía `audit_log` con el cliente del usuario (vacío para no-admin) | ✅ Service role acotado al tenant |
| M13 | Registro dinámico OAuth sin límite y `client_name` arbitrario en el consentimiento; códigos sin hash | Parcial. ✅ Límite por IP en `/oauth/register` y consentimiento con nombre y hosts tomados del servidor (10/10, S6). ⏳ Los códigos siguen guardados en claro (`lib/oauth/index.ts`) |
| M14 | `pushDueDate` en reconciliación sin tope ni auditoría | ✅ Máximo 25 fechas por corrida, cada una auditada (`lib/basecamp/reconcile.ts`, 10/10) |
| M15 | Datos personales reales en las capturas del manual (`docs/manual/img`) y project ref de Supabase en docs | ⏳ Regenerar capturas con datos semilla si el repo deja de ser privado |

### Bajos (registrados)

Cuerpos de error de Basecamp reflejados al usuario; refresh de token sin aviso al admin si Launchpad lo
rechaza; `procesarPendientes` sin claim atómico (posible correo doble si coinciden scheduler y cron externo);
mapa en memoria de `auth_publico` sin tope por IP (✅ desde el 10/10 los límites viven en Postgres); `tenantDefault()`
en el webhook de PrometIO; `logo_url` sin validar como URL https; `handle_new_auth_user` asume signup público
deshabilitado en Supabase Auth (✅ verificado el 10/10: registro apagado y «Confirm email» activo; además, desde la
migración 26 el alta exige correo confirmado); enlaces de invitación ya no se guardan en `audit_log` (✅); borrador del
Builder en `sessionStorage`; dependencias de desarrollo con avisos (vitest, vite, esbuild) que no afectan
producción.

### Lo que la revisión confirmó que está bien

- Regla 1 en todos los caminos: los extractores `*Safe`, el webhook y la importación nunca guardan
  descripciones ni comentarios; hay tests que lo fijan.
- Frontera cliente: `sanitizeForClient` es lista blanca, `assertClientSafe` segunda barrera, portal con
  token de 256 bits, `noindex`, `no-store`, sin políticas para `anon`.
- Credenciales: API keys y tokens OAuth hasheados y mostrados una vez; PKCE obligatorio; códigos de un solo
  uso; `timingSafeEqual` en webhooks; webhooks fail-closed en producción.
- MCP: preview + confirm con `plan_id` de un solo uso, límite de escrituras por credencial, alerta por
  escritura masiva (hasta el 10/10/2026 la alerta no se enviaba: insert perezoso sin destinatario; ver B11 en
  `HARDENING-CHANGELOG.md`).
- Historial git sin credenciales desde el primer commit; `.env` ignorado; sin `dangerouslySetInnerHTML`;
  el token de sesión nunca toca URL ni `localStorage`.

### Pasos que dependen de Luis

1. ~~Revisar y aplicar la migración 21~~ Hecho el 23/09.
2. ~~Desconectar y reconectar Basecamp (Admin → Integraciones) para rotar los tokens.~~ Hecho el 10/10.
3. ~~Cambiar `BASECAMP_WEBHOOK_SECRET` en Railway y re-registrar los webhooks de cada cliente.~~ Hecho el 10/10.
4. Definir `CRON_SECRET` en Railway (o dejar `/api/cron` cerrado, que es el estado actual en producción).
5. ~~Verificar en Supabase Auth que el registro público esté deshabilitado.~~ Verificado el 10/10.
6. ~~Decidir la ventana para subir a Next 15.~~ Hecho en la auditoría del 10/10 (Next 15.5).

## Auditoría run-1 (28–30/09/2026, skill cloudflare/security-audit, perfil quick)

Auditoría independiente solo sobre código fuente: 35 agentes, 21 candidatos, 18 hallazgos por validar y 3 descartados.
El informe está fuera del repo, en `~/security-audit-skill/backIO/run-1/` (`REPORT.md`, `NEEDS-VALIDATION.md`, `findings.json`,
`coverage-ledger.json`), y la próxima corrida parte de ahí. Los 18 hallazgos quedaron corregidos, con tests de regresión
(`src/__tests__/seguridad_auditoria.test.ts`, `notificaciones_destino.test.ts`, `webhook_basecamp_verificado.test.ts`) y con las
migraciones 24, 25 y 26 aplicadas y verificadas en producción el 30/09.

| Frente | Qué se corrigió |
|---|---|
| OAuth / MCP | `/oauth/approve` rechaza tokens de agente; redirect_uri solo https o http en loopback; «Denegar» valida el retorno en el servidor (`/oauth/deny`); `get_client_health` cerrado para keys de perfil cliente |
| Portal | Bloqueo del PIN que antes nunca se activaba; IP tomada del proxy; tope de 30 fallos por token |
| Roles | KPIs y evolutivo exigen rol también con token OAuth; las API keys solo las crea una persona admin |
| Base de datos | Funciones `auth_*` solo para usuarios activos (m25); reprocesos, reprogramaciones y bitácora solo sobre tareas propias (m25); trigger del colaborador en lista blanca y regla 3 (m25); notificaciones editables solo en `leida_at` (m24); alta de usuarios solo con correo confirmado (m26); RPC sin acceso anónimo y con chequeo de tenant (m26); `basecamp_url` solo https (m26) |
| Integraciones | Webhook de Basecamp aplica el estado del to-do vivo, no el del payload; PrometIO exige el timestamp firmado; las notificaciones se envían siempre al correo actual del usuario |
| Frontend | `next=` del login resuelto como URL del mismo origen; enlaces a Basecamp solo https |

Quedaron fuera de cobertura (perfil quick) y conviene empezar por ahí una corrida `standard`: las rutas que crean
tareas o plantillas y fijan `visible_cliente` al insertar (incluido el CSV masivo), y 8 routers de `/api/v1`
(proyectos, plantillas, huérfanos, horas, usuarios, personas, dashboard, tipos-pieza).

## Auditoría externa (10/10/2026) y endurecimiento por olas

Auditoría externa sobre el commit `f2e30e2`: veredicto «apto con correcciones», sin críticos ni altos de seguridad, pero con
dos bugs altos en producción y deuda estructural. Documentos en `~/claude-projects/auditorias/2026-10-10/`. El detalle,
hallazgo por hallazgo, con archivos y cómo se verificó, está en [Endurecimiento tras la auditoría](./endurecimiento.md) (copia de `HARDENING-CHANGELOG.md`).

| Frente | Qué cambió |
|---|---|
| Secretos en logs | El log de peticiones y el de errores redactan la ruta del webhook de Basecamp y la del portal, y no registran query strings (S1; el log de errores se corrigió en la Ola 7) |
| Datos expuestos | Clientes y mesas solo los escribe admin (S2); colaborador ve solo su fila en Personas y Horas (S3); credenciales de Basecamp solo en `integracion_credenciales`, sin fallback (S4); PIN del portal con scrypt en `portal_pines` (M3) |
| Agentes y OAuth | Consentimiento con datos del servidor (S6); refresh atómico con revocación de la familia (S8); `confirm_plan` verifica scope y autor antes de consumir (S9); API keys de cliente atadas a su cliente (S11); claim atómico al publicar actas (S7) |
| Entradas | Títulos de una línea (S5); `bodyLimit`; errores de validación legibles (B3); CSP con nonce en el frontend y `default-src 'none'` en el backend |
| Abuso | Límite de peticiones persistente en Postgres (`limites`); Turnstile en login y recuperar; signup público apagado en Supabase |
| Dependencias | `pnpm audit --prod --audit-level=high` en CI (de 34 vulnerabilidades a 0); Next 15 + React 19; Dependabot |
| Transacciones | Import CSV y Builder en `crear_lote` (B7); «quitar acceso» en `quitar_acceso`, credenciales primero (B8) — migración 29 |
| Operación | Jobs con ventana y registro en `cron_runs` (B10); logger JSON con niveles; Sentry opcional sin datos personales |

Migraciones de esta ronda: 27 (seguridad), 28 (límites y `cron_runs`) y 29 (transacciones), aplicadas y verificadas
por Luis entre el 10 y el 11/10.
