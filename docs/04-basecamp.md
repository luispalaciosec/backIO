# 04 · Integración con Basecamp

> Revisado contra el código el 11/10/2026.

> Zona de revisión humana obligatoria para escrituras.
> Basecamp es el sistema de producción vivo de Geeks. Un bug aquí ensucia proyectos reales.

---

## Principio: unidireccionalidad de estados

| Dato | Fuente de verdad | Dirección |
|---|---|---|
| `completed` / `completed_at` | **Basecamp** | Basecamp → BackIO |
| Existencia del to-do | BackIO lo crea; desde el 23/09/2026 también entra lo creado en Basecamp | Ambas |
| `due_on` | BackIO | BackIO → Basecamp (al crear y al reprogramar) |
| Asignaciones | BackIO | BackIO → Basecamp |
| Estado operativo, aprobación, prioridad, peso | **BackIO** | No sale |
| Comentarios, adjuntos, descripciones | **Basecamp** | **No entra jamás** |

Basecamp solo conoce `completed: true/false`. BackIO tiene ocho estados operativos. Intentar
mapearlos en ambos sentidos genera conflictos permanentes. **No se hace.**

---

## Autenticación

OAuth2 de Basecamp 3, con dos clases de cuenta (migración 33, 16/10/2026):

- **La de cada persona** («Mi Basecamp»). Basecamp registra como autor a la cuenta que hace cada cambio, así que lo que
  alguien hace desde BackIO (crear proyectos o tareas, cambiar una fecha, reabrir, publicar el daily o un acta,
  registrar una salida, aplicar Mantenimiento) va con **su** cuenta y sale a su nombre, con sus avisos. Antes todo
  salía a nombre de quien había conectado la integración. Si la persona no conectó su cuenta, BackIO no escribe en
  Basecamp por ella: responde 428 (`basecamp_sin_conectar`) **antes** de cambiar nada, y la pantalla muestra el
  botón «Conectar mi Basecamp» (decisión de Luis, 16/10/2026). Al conectar, BackIO comprueba que la cuenta autorizada
  sea la de esa persona (`usuarios.basecamp_user_id`, o el mismo correo si todavía no estaba enlazada): nadie puede
  conectar la cuenta de otro. Tokens en `basecamp_credenciales_usuario` (solo service role). Al registrar la salida de
  alguien, su conexión se borra.
- **Lo automático con un responsable** también va con la cuenta de esa persona, si la conectó
  (`BasecampClient.forResponsable`): el proyecto mensual de un fee recurrente, con la de la **ejecutiva** del proyecto;
  la fecha que la reconciliación reenvía, con la de **quien la cambió por última vez** en BackIO. Si esa persona no
  conectó su cuenta, se usa la de la organización.
- **La de la organización** (Admin → Integraciones), para lo demás: lecturas (sincronización, horas, huérfanos),
  webhooks, las API keys de integraciones (no tienen persona) y lo automático cuyo responsable no conectó su cuenta. No
  hace falta un usuario aparte: alcanza con la cuenta de quien la conectó (decisión de Luis, 16/10/2026).

Código: `BasecampClient.forActor(ctx)` (persona, o la de la organización si no hay persona) y `forTenant` (solo
organización), en `backend/src/lib/basecamp/client.ts`; validación de identidad en `lib/basecamp/persona.ts`.

```
BASECAMP_CLIENT_ID
BASECAMP_CLIENT_SECRET
BASECAMP_ACCOUNT_ID
BASECAMP_REDIRECT_URI
```

El token de acceso y el de refresh de la organización se guardan en la tabla `integracion_credenciales`, como JSON sin cifrar (los de cada persona, en `basecamp_credenciales_usuario`, con la misma protección). La
protección es de acceso: la tabla tiene RLS activo y ninguna política, así que solo el service role del backend
puede leerla (`backend/src/lib/basecamp/credenciales.ts`, migración `20260923000021_seguridad_rls.sql`). Antes
estaban en `tenants.config`, que cualquier usuario del tenant podía leer. El refresh es automático cuando falta
menos de un minuto para que expire el token.

**User-Agent obligatorio** (Basecamp lo exige y bloquea sin él). Se configura con `BASECAMP_USER_AGENT`; el
valor por defecto es:
```
User-Agent: BackIO Geeks (correo@dominio)
```

Rate limit de Basecamp: 50 req / 10 seg. El cliente HTTP (`backend/src/lib/basecamp/client.ts`) se frena solo a
45 peticiones por cada 10 segundos. Si Basecamp responde 429 o un error 5xx, reintenta hasta 5 veces: espera lo
que indique `Retry-After` o, si no viene, 1, 2, 4, 8 y 16 segundos.

---

## Estructura real (sprint 1, 04/09/2026)

| Basecamp | BackIO |
|---|---|
| Proyecto (marca) | `clientes.basecamp_project_id` |
| Lista de to-dos | Proyecto de BackIO. Se reutiliza por nombre si ya existe; si no, se crea con el nombre del proyecto |
| Grupo dentro de la lista | Bloque de la plantilla (`proyectos.basecamp_grupos`) |
| To-do | Requerimiento. `due_on` obligatorio; `completion_subscriber_ids` = ejecutiva + operaciones |
| Board "Weekly (Status Semanal)" de la mesa | Plan Operativo y Acta de Cierre como mensaje (`mesas.basecamp_board_weekly_id`) |
| Board "Daily (apertura/cierre)" de la mesa | Apertura y cierre generados desde el Daily (`mesas.basecamp_board_daily_id`) |

## Escritura: crear proyecto

Al confirmar el paso 5 del Builder, BackIO arma la estructura en Basecamp con `createProjectStructure`
(`backend/src/lib/basecamp/write.ts`):

1. El proyecto de Basecamp ya existe (`clientes.basecamp_project_id`). BackIO nunca crea proyectos en Basecamp,
   solo listas dentro de ellos. Si el cliente no tiene proyecto configurado, no se escribe nada.
2. La lista de to-dos se llama igual que el proyecto de BackIO (`proyecto.nombre`). Si ya existe una lista con
   ese nombre, sin distinguir mayúsculas, se reutiliza. Si no, se crea con la descripción «Gestionado desde
   BackIO. Entrega: …».
3. Dentro de la lista se usa un grupo por bloque, también reutilizado por nombre si ya existe. Los ids quedan en
   `proyectos.basecamp_grupos`.
4. Cada requerimiento se vuelve un to-do dentro del grupo de su bloque. El texto del to-do es el
   `titulo_interno`, con su `due_on`, los responsables vinculados a Basecamp y `completion_subscriber_ids` (la
   ejecutiva del proyecto y las personas de operaciones). El id y la URL del to-do se guardan en el
   requerimiento.

Todo to-do lleva fecha: si algún requerimiento no tiene fecha de entrega, la operación se detiene antes de
escribir. Un requerimiento creado después en un proyecto ya sincronizado se sube con `pushRequerimiento`, en el
grupo de su bloque.

::: details Diseño original (no es el código actual)
El diseño inicial creaba una lista llamada «{nombre} · BackIO» y to-dos con el texto
`[bloque] titulo_interno`, sin grupos. La estructura real es la de la tabla «Estructura real (sprint 1)».
:::

**Salvaguardas obligatorias:**

| Salvaguarda | Regla |
|---|---|
| Límite por operación | Máximo 50 to-dos en una sola creación (decisión 03/09/2026). Sobre eso, confirmación explícita adicional |
| Idempotencia | Si `basecamp_todo_id` ya existe, no recrear |
| Rollback | Si falla a mitad, el proyecto queda con `sync_estado = 'incompleto'` y se reintenta con `POST /proyectos/:id/basecamp/reintentar` — nunca dejar estado ambiguo |
| Sandbox | Toda escritura nueva se prueba primero contra un proyecto Basecamp de pruebas |

---

## Lectura: webhook

Basecamp soporta webhooks por proyecto. Se registra uno por cliente activo.

```
POST /api/webhooks/basecamp/:token
```

El código está en `backend/src/routes/webhooks/basecamp.ts`, montado en `/api/webhooks/basecamp`.

**Autenticidad.** Basecamp no firma los webhooks. La URL registrada lleva al final un secreto
(`BASECAMP_WEBHOOK_SECRET`) que solo conocen BackIO y Basecamp; si no coincide, la respuesta es 401. La ruta sin
secreto solo funciona fuera de producción.

**Eventos.** Se procesan diez tipos de evento de to-do (`backend/src/lib/basecamp/sync.ts`): `todo_completed`,
`todo_uncompleted`, `todo_changed`, `todo_created`, `todo_assignment_changed`, `todo_due_on_changed`,
`todo_trashed`, `todo_archived`, `todo_untrashed` y `todo_unarchived`. Los demás se responden con 200 y se
ignoran.

**Extracción estricta.** `extractSafePayload` arma el payload campo a campo (ver
[02 · Visibilidad](./02-visibilidad.md), Defensa 1). El JSON crudo no se guarda ni se escribe en el log.

Qué pasa con cada evento:

1. **To-do que BackIO no conoce.** Si es `todo_created`, `todo_untrashed`, `todo_unarchived` o `todo_changed`,
   se programa la importación de ese cliente con 20 segundos de espera, para agrupar varias creaciones seguidas
   (`programarImportacion`). Así lo creado a mano en Basecamp entra en menos de un minuto.
2. **To-do gestionado por BackIO.** El estado no se toma del payload. Se lee el to-do vivo en Basecamp, en el
   proyecto del cliente guardado en BackIO (`estadoVivo`). Si el evento viene de otro proyecto, se descarta. Si
   Basecamp no responde, el webhook devuelve 503 y Basecamp reintenta.
3. **Aplicar el cambio** (`applyBasecampUpdate`):
   - En la papelera o archivado: el requerimiento pasa a `cancelado` (auditoría `basecamp_eliminado`).
   - Restaurado: si estaba cancelado, vuelve a `en_ejecucion` (auditoría `basecamp_restaurado`).
   - Completado: pasa a `completado` con su `completado_at`, y se cierra el reproceso abierto si lo había.
   - Desmarcado: vuelve a `en_ejecucion`.
   - Un requerimiento cancelado en BackIO no se reabre por un evento de completado.

El avance del proyecto no se recalcula en código: sale de la vista `v_proyectos_avance`. El estado del proyecto
lo mueve el trigger que llama a `proyectos_recalcular_estado` cada vez que cambia un requerimiento (migración
`20260907000018_proyecto_estado_auto.sql`).

**Reapertura:** si un to-do completado se marca como no completado, el requerimiento vuelve
a `en_ejecucion`, no a `backlog`. Además se registra un reproceso con origen `basecamp` y sin causa, que la mesa
completa después (ver [16 · Cumplimiento](./16-cumplimiento.md)).

::: details Diseño original (no es el código actual)
El diseño inicial era una ruta de Next.js (`app/api/webhooks/basecamp/route.ts`) que verificaba una firma,
procesaba solo `todo_completed`, `todo_uncompleted` y `todo_changed`, confiaba en el payload e ignoraba los to-dos
creados fuera de BackIO. Ninguna de esas cuatro cosas sigue así.
:::

### Gestión de los webhooks

Solo admin puede registrarlos y revisarlos:

| Endpoint | Qué hace |
|---|---|
| `POST /clientes/:id/basecamp/webhook` | Registra el webhook en el proyecto Basecamp del cliente. Si ya existe, no hace nada |
| `GET /clientes/:id/basecamp/webhook` | Diagnóstico del webhook de ese cliente |
| `POST /clientes/basecamp/webhooks/actualizar` | Tras rotar el secreto, reescribe la URL en todos los clientes activos y registra los que falten |

En `clientes.config` solo queda el id del webhook. La URL completa lleva el secreto y la API nunca la devuelve
entera.

---

## Fallback: polling

Los webhooks de Basecamp fallan ocasionalmente. El job `reconcile` corre cada 30 minutos
(`backend/src/lib/basecamp/reconcile.ts`). Recorre los requerimientos activos que tienen to-do enlazado, lee cada
to-do vivo y aplica las diferencias de estado con la misma lógica del webhook.

También corrige fechas. BackIO manda sobre `due_on`: si la fecha en Basecamp no coincide con la de BackIO, se
reenvía la de BackIO. Para que un desfase masivo no se propague de golpe, se reenvían como máximo 25 fechas por
corrida, y cada una queda en la auditoría.

Sin esto, un webhook perdido deja una tarea marcada como pendiente indefinidamente — y esa
tarea termina apareciendo como falso atraso en el weekly.

---

## Lo que NO se hace en v1

| Descartado | Razón |
|---|---|
| Sincronización de comentarios | Rompe la Defensa 1. Nunca se hará |
| Sincronización de adjuntos | Mismo motivo. BackIO no guarda archivos: de los entregables solo guarda enlaces (`entregable_urls`) |
| Crear proyectos en Basecamp | El proyecto de cliente ya existe y tiene configuración manual |
| Mapeo de Card Table | El Card Table de Basecamp queda deprecado; BackIO lo reemplaza |
| Sincronización de estados ricos | Ver principio de unidireccionalidad |

---

## Migración del Card Table existente

El WorkOS actual define un Card Table en Basecamp como "Backlog Priorizado". BackIO lo
reemplaza.

**Plan:** durante 4 semanas ambos coexisten (BackIO es la fuente, el Card Table se mantiene
manualmente como respaldo). A la quinta semana, el Card Table se archiva.

No se migra automáticamente: se hace export CSV y se importa con el bulk import del Builder,
asignando bloques y pesos a mano. Es una sola vez y garantiza limpieza.


## Sincronización de estructura (17/09/2026, feedback de operaciones)

Basecamp → BackIO, automático:

| Cambio en Basecamp | Efecto en BackIO | Cuándo |
|---|---|---|
| To-do completado / reabierto | Estado completado / en proceso (+ reproceso) | Webhook, segundos |
| To-do enviado a la papelera o archivado | Requerimiento **cancelado** (auditoría `basecamp_eliminado`); si se restaura, vuelve a En proceso | Webhook, segundos; verificación cada 15 min |
| Título del to-do editado | `titulo_interno` (excepción D1, solo por la lectura de listas; el webhook sigue sin extraer texto) | Cada 15 min o con ↻ Sincronizar |
| To-do movido a otra lista o grupo | Cambia de proyecto / bloque | Cada 15 min |
| To-do movido a **otro proyecto de Basecamp** (otro cliente) | Basecamp crea un to-do nuevo y el id viejo redirige a él. Si el nuevo ya entró a BackIO, la tarea vieja se da de baja (no queda duplicada); si no, la tarea vieja pasa al to-do nuevo y a su cliente, oculta en el portal. Queda `basecamp_movido` en la auditoría | Cada 15 min |
| Lista renombrada | Nombre del proyecto | Cada 15 min |
| Responsables cambiados | `owner_agencia` (si la persona está vinculada), solo en tareas abiertas. No cambia si Basecamp todavía asigna a alguien que ya no tiene acceso: ahí manda el reparto de BackIO | Cada 15 min |
| To-do nuevo creado a mano | Se importa como requerimiento (ver «Basecamp como origen aceptado») | Webhook, unos 20 s; cada 15 min como respaldo |
| Lista nueva | Se importa como proyecto | Cada 15 min |
| Horas del timesheet | Horas por tarea y persona (también de quien ya no tiene acceso) | Cada 6 h |

Manual e inmediato: Admin → Clientes → **↻ Sincronizar Basecamp** (`POST /clientes/:id/basecamp/importar`) hace lo
mismo que la corrida de 15 min para ese cliente. Lo pueden usar admin, operaciones y ejecutivas.
BackIO → Basecamp: fecha de entrega (al instante), estructura de proyectos del Builder, reapertura por reproceso, mensajes de daily/weekly/informe.
Nunca: comentarios, descripciones, adjuntos.


## Incidente 22/09/2026: asignados borrados en Basecamp

**Causa.** Basecamp trata `PUT /todos/:id.json` como reemplazo del to-do: un PUT que solo enviaba `due_on`
dejaba los asignados vacíos y, además, no aplicaba la fecha (verificado en el sandbox: HTTP 200, assignees [],
due_on sin cambio). Ese PUT lo hacía BackIO al reprogramar y, desde el 17/09, la reconciliación cada 30 min
para cualquier tarea con fecha distinta entre BackIO y Basecamp. Efecto: a las pocas horas de asignar en
Basecamp, la tarea quedaba sin dueño; y las fechas cambiadas en BackIO no llegaban a Basecamp (punto 1 de Marcia).

**Corrección.** `BasecampClient.updateTodo` lee el to-do vivo y en cada PUT reenvía siempre `content`,
`description`, `due_on`, `starts_on`, `assignee_ids` y `completion_subscriber_ids`, cambiando solo lo pedido. La
descripción se reenvía en memoria y nunca se guarda en BackIO (regla 1 intacta). Antes de reenviarla se limpian
los adjuntos que trae incrustados, para que Basecamp no los desarme en cada cambio de fecha
(`descripcionParaGuardar`). Reparación: un script (hoy Admin → Mantenimiento, «Responsables perdidos en Basecamp») volvió a
poner el responsable de BackIO en los to-dos abiertos que quedaron sin asignar (43 + 23).

## Basecamp como origen aceptado (23/09/2026)

Decisión de Luis tras una semana de uso real: 5 de 23 usuarios activos, producción sigue creando to-dos a mano
en Basecamp y las ejecutivas gastaban su tiempo importando y adoptando huérfanos. El flujo
cliente → ejecutiva → BackIO → Basecamp sigue siendo el preferido, pero deja de ser el único.

- **Sincronización completa cada 15 min** (job `estructura`, que llama a `importarBasecampCliente` para todo
  cliente activo con proyecto Basecamp): listas nuevas → proyectos, grupos → bloques, to-dos nuevos →
  requerimientos (`tipo=fee`, `prioridad=media`, `visible_cliente=false`, responsables por `basecamp_user_id`),
  además de renombres, movimientos, responsables y eliminados. Sigue entrando solo el título (excepción D1).
- **Estado inicial de lo importado** (`filaDesdeTodo` en `backend/src/lib/basecamp/decisiones.ts`): `completado`
  si el to-do ya estaba completado, `priorizado` si tiene fecha y `backlog` si no la tiene. Los to-dos completados
  hace más de 60 días no se importan.
- **Cada to-do nuevo deja `audit basecamp_entrada`** (todo, lista, bloque, creador, si quedó sin responsable) y
  cierra su huérfano pendiente si lo había.
- **«Entradas desde Basecamp»** (`/huerfanos`, `GET /huerfanos/entradas`): bandeja de lo que entró en 14 días y
  nadie revisó. La ejecutiva completa responsables, prioridad, tipo, aprobación y piezas en línea y marca
  «Revisada» (`POST /huerfanos/entradas/:id/revisada` → `audit revisar_entrada`). No bloquea nada: la tarea ya
  está en el backlog y en su proyecto desde que entró.
- El detector de huérfanos ya no corre por cron (queda el endpoint manual). La regla 2 no cambia: lo importado
  nace oculto al cliente.

### Entrada en segundos por webhook (24/09/2026)

El webhook de Basecamp ya avisaba `todo_created`, pero solo se usaba para estados. Ahora, si llega un
`todo_created` (o `untrashed`/`unarchived`/`changed`) de un to-do que BackIO no conoce, se programa una
sincronización de estructura **solo de ese cliente** con 20 s de debounce (`backend/src/routes/webhooks/basecamp.ts`,
`programarImportacion`). Resultado: lo creado a mano en Basecamp entra en menos de un minuto. La corrida
periódica baja a 15 min y queda como red de seguridad (renombres, movimientos, eliminados, webhook caído).

### Cómo está armada la importación

La importación se divide en tres archivos de `backend/src/lib/basecamp/`:

| Archivo | Qué hace |
|---|---|
| `importar.ts` | Orquesta: recorre las listas del cliente, crea o actualiza proyectos y requerimientos, cancela lo eliminado |
| `decisiones.ts` | Decide qué hacer con cada to-do (enlazado, nuevo, ignorado o completado viejo) y arma las filas. No hace llamadas, así se puede probar |
| `recorrer.ts` | Recorre listas y grupos y mapea usuarios de Basecamp a usuarios de BackIO. Lo comparte con el detector de huérfanos |

Dos importaciones del mismo cliente no corren a la vez: la segunda espera a que termine la primera
(`conCandado` en `backend/src/lib/candado.ts`, con la clave del tenant y el cliente). El candado vive en memoria y
alcanza con una sola réplica del backend; entre réplicas, la defensa es el índice único de la base que impide dos
proyectos para la misma lista.
