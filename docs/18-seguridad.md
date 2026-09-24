# 18 · Revisión de seguridad (23/09/2026)

Tres revisiones independientes sobre todo el código (backend: auth, RLS y API · integraciones,
webhooks e IA · frontend, secretos y dependencias). Cada hallazgo fue verificado leyendo el código.
Este documento es el registro: qué se encontró, qué se corrigió y qué queda pendiente y por qué.

## Estado

| Estado | Significado |
|---|---|
| ✅ Corregido | Código desplegado el 23/09 |
| 🗄️ Migración 21 | Corregido en `20260923000021_seguridad_rls.sql`, aplicada por Luis el 23/09 (verificado: tokens en `integracion_credenciales`, `tenants.config` sin `basecamp`, sin URLs de webhook) |
| ⏳ Pendiente | Requiere decisión o trabajo aparte |

## Críticos

| # | Hallazgo | Estado |
|---|---|---|
| C1 | **Tokens OAuth de Basecamp legibles por cualquier usuario.** Vivían en `tenants.config`, columna visible por RLS para todo `authenticated`. Con el token se leen comentarios y adjuntos de todos los proyectos: la regla 1 quedaba rota por fuera de BackIO. | ✅ Código: nueva tabla `integracion_credenciales` (solo service role) con `lib/basecamp/credenciales.ts`, y fallback al esquema viejo hasta aplicar la migración. 🗄️ Migración 21 crea la tabla, mueve los tokens y los borra de `tenants.config`. **Después de aplicarla: desconectar y volver a conectar Basecamp en Admin → Integraciones para rotar los tokens.** |
| C2 | **Escalada a admin.** La política `usuarios_update_self` dejaba que un usuario cambiara su propio `rol` por PostgREST. | 🗄️ Migración 21: trigger que protege `rol`, `activo`, `tenant_id`, `email`, `basecamp_user_id`, `capacidad_semanal` salvo admin o service role. |

## Altos

| # | Hallazgo | Estado |
|---|---|---|
| A1 | Secreto del webhook de Basecamp guardado en `clientes.config` (en la URL) y devuelto por la API a cualquier rol. Permitía forjar eventos `todo_completed`/`todo_trashed`. | ✅ Ya no se persiste la URL; `config` de clientes solo se devuelve a admin. 🗄️ Migración 21 borra las URLs guardadas. ⏳ **Rotar `BASECAMP_WEBHOOK_SECRET` en Railway y re-registrar los webhooks** (Admin → Clientes) |
| A2 | `/api/cron/*` público si `CRON_SECRET` no estaba definida. | ✅ Fail-closed en producción y comparación en tiempo constante |
| A3 | API keys de perfil `cliente` podían usar la REST y ver títulos internos y toda la cartera. | ✅ Rechazadas fuera del MCP (que sí sanitiza) |
| A4 | Un token OAuth del MCP con scope mínimo pasaba `requireScope('admin')` si el dueño era admin. | ✅ Exención eliminada; OAuth nunca alcanza rutas admin |
| A5 | Colaborador podía editar cualquier columna de sus tareas por PostgREST, y por la API editar notas, reprogramaciones y reprocesos ajenos. | ✅ API: verificación de propiedad en bitácora (crear/borrar), reprogramaciones y reprocesos; un colaborador no publica notas al cliente. 🗄️ Migración 21: trigger que limita columnas y políticas de bitácora/reprogramaciones/reprocesos a gestión o dueño |
| A6 | **Next.js 14.2 sin parches** para 23 avisos (2 críticos, 8 altos; DoS y cache poisoning aplican al App Router). | ⏳ Subir a Next 15.5. Implica `params`/`cookies` asíncronos y probar el middleware. Tarea aparte con ventana de pruebas |

## Medios

| # | Hallazgo | Estado |
|---|---|---|
| M1 | Open redirect en `/login?next=` | ✅ Solo rutas internas |
| M2 | Sin cabeceras de seguridad en el frontend | ✅ `X-Frame-Options`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS. ⏳ CSP completa: requiere inventariar orígenes (Supabase, backend, avatares de Basecamp) |
| M3 | PIN del portal: sin límite de intentos, comparación no constante | ✅ `timingSafeEqual` y bloqueo de 15 min tras 8 fallos por token+IP. ⏳ Guardar el PIN hasheado |
| M4 | IDOR con service role en `guardarPlantilla` (regla 5) | ✅ Se verifica que el id sea del tenant; borrado de bloques filtrado por tenant |
| M5 | `visible_cliente=true` aceptado en el INSERT desde API/agente sin plantilla (regla 2 solo cubría UPDATE) | 🗄️ Migración 21: trigger `before insert` |
| M6 | Inyección de `ruta` en correos (`\n__ruta__:` dentro de un título) → botón «Abrir en BackIO» a un dominio ajeno | ✅ La ruta solo se acepta si es un path interno; título sin saltos de línea; `href` escapado |
| M7 | Scheduler sin lock: corridas solapadas duplicaban proyectos | ✅ Lock por job. 🗄️ Migración 21: índice único `proyectos(tenant_id, basecamp_todolist_id)` |
| M8 | Webhook PrometIO sin anti-replay | ✅ Ventana de ±5 min si viene `X-Prometio-Timestamp` y rechazo de cuerpos repetidos en 10 min |
| M9 | `esc()` no escapaba comillas y se usaba en atributos | ✅ |
| M10 | Scripts con `PUT` crudo a Basecamp y one-offs sin confirmación en el repo | ✅ `exp_*` eliminados; `scripts/README.md` con reglas. ⏳ Convertir reparaciones recurrentes en endpoints de admin |
| M11 | `ultimo_uso_at` de API keys nunca se actualizaba (builder sin `await`) | ✅ |
| M12 | «Entradas desde Basecamp» leía `audit_log` con el cliente del usuario (vacío para no-admin) | ✅ Service role acotado al tenant |
| M13 | Registro dinámico OAuth sin límite y `client_name` arbitrario en el consentimiento; códigos sin hash | ⏳ Rate limit por IP, mostrar host de `redirect_uri`, `sha256(code)` |
| M14 | `pushDueDate` en reconciliación sin tope ni auditoría | ⏳ Toca `lib/basecamp/write.ts` (zona de revisión humana) |
| M15 | Datos personales reales en las capturas del manual (`docs/manual/img`) y project ref de Supabase en docs | ⏳ Regenerar capturas con datos semilla si el repo deja de ser privado |

## Bajos (registrados, sin corregir)

Cuerpos de error de Basecamp reflejados al usuario; refresh de token sin aviso al admin si Launchpad lo
rechaza; `procesarPendientes` sin claim atómico (posible correo doble si coinciden scheduler y cron externo);
mapa en memoria de `auth_publico` sin tope por IP; `tenantDefault()` en el webhook de PrometIO; `logo_url`
sin validar como URL https; `handle_new_auth_user` asume signup público deshabilitado en Supabase Auth
(**verificar en el dashboard**); enlaces de invitación ya no se guardan en `audit_log` (✅); borrador del
Builder en `sessionStorage`; dependencias de desarrollo con avisos (vitest, vite, esbuild) que no afectan
producción.

## Lo que la revisión confirmó que está bien

- Regla 1 en todos los caminos: los extractores `*Safe`, el webhook y la importación nunca guardan
  descripciones ni comentarios; hay tests que lo fijan.
- Frontera cliente: `sanitizeForClient` es lista blanca, `assertClientSafe` segunda barrera, portal con
  token de 256 bits, `noindex`, `no-store`, sin políticas para `anon`.
- Credenciales: API keys y tokens OAuth hasheados y mostrados una vez; PKCE obligatorio; códigos de un solo
  uso; `timingSafeEqual` en webhooks; webhooks fail-closed en producción.
- MCP: preview + confirm con `plan_id` de un solo uso, límite de escrituras por credencial, alerta por
  escritura masiva.
- Historial git sin credenciales desde el primer commit; `.env` ignorado; sin `dangerouslySetInnerHTML`;
  el token de sesión nunca toca URL ni `localStorage`.

## Pasos que dependen de Luis

1. ~~Revisar y aplicar la migración 21~~ Hecho el 23/09.
2. Desconectar y reconectar Basecamp (Admin → Integraciones) para rotar los tokens.
3. Cambiar `BASECAMP_WEBHOOK_SECRET` en Railway y re-registrar los webhooks de cada cliente.
4. Definir `CRON_SECRET` en Railway (o dejar `/api/cron` cerrado, que es el estado actual en producción).
5. Verificar en Supabase Auth que el registro público esté deshabilitado.
6. Decidir la ventana para subir a Next 15.
