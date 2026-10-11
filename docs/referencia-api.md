---
outline: [2, 3]
---

# Referencia de la API REST

::: info Generado
Esta página se genera desde el código (`backend/scripts/gen_docs_api.ts`, a partir de `routes/openapi.ts`). No se
edita a mano: `pnpm --filter @backio/backend docs:api`. El CI falla si quedó desactualizada.
:::

Versión 1.0.0. Base: `https://<backend>/api/v1`. El spec completo en JSON está en `GET /api/openapi.json`.

Son las rutas pensadas para integraciones (PrometIO, agentes, reportes). Las que usa solo la interfaz de BackIO no se
publican aquí; están en `backend/src/routes/v1/` y se resumen en [Arquitectura técnica](./17-arquitectura-tecnica.md).

**Autenticación.** Cada petición lleva `Authorization: Bearer <credencial>`: la sesión de un usuario de BackIO, una
API key (`bk_live_…`, se crean en Admin → API keys) o un token OAuth de un agente. Lo que se puede hacer depende de los
scopes de la credencial y del rol de la persona (ver [API y agentes](./07-api-mcp.md)).

**Errores.** Toda respuesta de error trae `{ "error": "texto para mostrar" }`; los de validación agregan
`detalle` con el campo y el motivo (`400 · Revisa: fecha_entrega, piezas`).

## clientes

### `GET /clientes`

Lista de clientes

| Parámetro | En | Tipo | Descripción |
|---|---|---|---|
| `todos` | query | string | 1 para incluir inactivos |

**Respuestas:**

- `200` OK — lista de [Cliente](#cliente) en `items`

### `GET /clientes/{id}/resumen`

Resumen de entrega de un cliente (widget PrometIO)

| Parámetro | En | Tipo | Descripción |
|---|---|---|---|
| `id` (obligatorio) | ruta | string (uuid) |  |

**Respuestas:**

- `200` OK — [ResumenCliente](#resumencliente)
- `404` No encontrado — [Error](#error)

## dashboard

### `GET /dashboard`

KPIs, salud por cliente, carga por persona, arrastre, serie 8 semanas

| Parámetro | En | Tipo | Descripción |
|---|---|---|---|
| `mesa` | query | string | uuid de la mesa |

**Respuestas:**

- `200` Dashboard

## horas

### `GET /horas/resumen`

Horas de Basecamp (timesheet) por cliente, persona, proyecto y requerimiento. Solo números

| Parámetro | En | Tipo | Descripción |
|---|---|---|---|
| `dias` | query | string | ventana en días (default 30) |

**Respuestas:**

- `200` ResumenHoras

## huerfanos

### `GET /huerfanos`

To-dos creados en Basecamp fuera de BackIO (solo título, fechas, creador)

**Respuestas:**

- `200` Huérfanos pendientes

### `POST /huerfanos/{id}/adoptar`

Crear el requerimiento en BackIO enlazado al to-do

| Parámetro | En | Tipo | Descripción |
|---|---|---|---|
| `id` (obligatorio) | ruta | string (uuid) |  |

**Respuestas:**

- `200` Requerimiento

## ia

### `POST /ia/weekly`

Status semanal narrado por IA + agenda por causa con pregunta de decisión (solo redacta)

**Cuerpo:** objeto

**Respuestas:**

- `200` WeeklyIA

### `POST /ia/brief`

Convierte el pedido de un cliente en brief estructurado + plantilla y piezas sugeridas

**Cuerpo:** objeto

**Respuestas:**

- `200` BriefIA

### `POST /ia/informe-mensual`

Informe ejecutivo mensual por mesa (se guarda como acta; una persona lo publica)

**Cuerpo:** objeto

**Respuestas:**

- `201` Acta

## mesas

### `GET /mesas`

Mesas (equipos de cuenta)

**Respuestas:**

- `200` Mesas

## plantillas

### `GET /plantillas`

Plantillas disponibles

**Respuestas:**

- `200` OK — lista de [Plantilla](#plantilla) en `items`

## proyectos

### `GET /proyectos`

Proyectos

| Parámetro | En | Tipo | Descripción |
|---|---|---|---|
| `cliente` | query | string | uuid del cliente |
| `estado` | query | `backlog` · `priorizado` · `en_ejecucion` · `en_revision` · `reprogramado` · `bloqueado` · `completado` · `cancelado` | estado operativo |

**Respuestas:**

- `200` OK — lista de [Proyecto](#proyecto) en `items`

### `POST /proyectos`

Crear proyecto desde plantilla (crea to-dos en Basecamp)

**Cuerpo:** [CrearProyecto](#crearproyecto)

**Respuestas:**

- `201` Creado

### `POST /proyectos/preview`

Plan y vista cliente sin crear nada

**Cuerpo:** [CrearProyecto](#crearproyecto)

**Respuestas:**

- `200` Preview

### `GET /proyectos/{id}`

Detalle con requerimientos

| Parámetro | En | Tipo | Descripción |
|---|---|---|---|
| `id` (obligatorio) | ruta | string (uuid) |  |

**Respuestas:**

- `200` OK — [Proyecto](#proyecto)
- `404` No encontrado — [Error](#error)

### `GET /proyectos/{id}/vista-cliente`

Exactamente lo que ve el cliente en el portal

| Parámetro | En | Tipo | Descripción |
|---|---|---|---|
| `id` (obligatorio) | ruta | string (uuid) |  |

**Respuestas:**

- `200` ClientSafeProject

## requerimientos

### `GET /requerimientos`

Backlog filtrado

| Parámetro | En | Tipo | Descripción |
|---|---|---|---|
| `cliente` | query | string | uuid |
| `proyecto` | query | string | uuid |
| `owner` | query | string | uuid usuario |
| `estado` | query | `backlog` · `priorizado` · `en_ejecucion` · `en_revision` · `reprogramado` · `bloqueado` · `completado` · `cancelado` | estado operativo |
| `activos` | query | string | 1 = excluir completados/cancelados |
| `min_dias_atraso` | query | string | entero |
| `desde` | query | string | fecha_entrega >= YYYY-MM-DD |
| `hasta` | query | string | fecha_entrega <= YYYY-MM-DD |
| `q` | query | string | texto en título interno |

**Respuestas:**

- `200` OK — lista de [Requerimiento](#requerimiento) en `items`

### `POST /requerimientos`

Crear requerimiento

**Cuerpo:** [CrearRequerimiento](#crearrequerimiento)

**Respuestas:**

- `201` Creado — [Requerimiento](#requerimiento)

### `GET /requerimientos/{id}`

Un requerimiento

| Parámetro | En | Tipo | Descripción |
|---|---|---|---|
| `id` (obligatorio) | ruta | string (uuid) |  |

**Respuestas:**

- `200` OK — [Requerimiento](#requerimiento)
- `404` No encontrado — [Error](#error)

### `PATCH /requerimientos/{id}`

Actualizar (no se puede abrir visibilidad ni completar si vive en Basecamp)

| Parámetro | En | Tipo | Descripción |
|---|---|---|---|
| `id` (obligatorio) | ruta | string (uuid) |  |

**Cuerpo:** [ActualizarRequerimiento](#actualizarrequerimiento)

**Respuestas:**

- `200` OK — [Requerimiento](#requerimiento)
- `404` No encontrado — [Error](#error)

### `GET /requerimientos/{id}/historial`

Reprogramaciones (fecha anterior, nueva, motivo) y reprocesos (origen, causa, paso, horas) de la tarea

| Parámetro | En | Tipo | Descripción |
|---|---|---|---|
| `id` (obligatorio) | ruta | string (uuid) |  |

**Respuestas:**

- `200` HistorialRequerimiento

### `POST /requerimientos/{id}/reprocesos`

El entregable vuelve al equipo: registra causa de catálogo, reabre la tarea y el to-do en Basecamp

| Parámetro | En | Tipo | Descripción |
|---|---|---|---|
| `id` (obligatorio) | ruta | string (uuid) |  |

**Cuerpo:** objeto

**Respuestas:**

- `201` Reproceso

### `GET /requerimientos/causas-pendientes`

Reprogramaciones y reprocesos sin causa registrada (45 días)

**Respuestas:**

- `200` Pendientes

## semanas

### `GET /semanas/actual`

Semana ISO en curso

**Respuestas:**

- `200` Semana

### `GET /semanas/{id}/senales`

Señales del weekly

| Parámetro | En | Tipo | Descripción |
|---|---|---|---|
| `id` (obligatorio) | ruta | string (uuid) |  |

**Respuestas:**

- `200` OK — lista de [Senal](#senal) en `items`

### `GET /semanas/{id}/capacidad`

Carga por persona

| Parámetro | En | Tipo | Descripción |
|---|---|---|---|
| `id` (obligatorio) | ruta | string (uuid) |  |

**Respuestas:**

- `200` Capacidad

### `POST /semanas/{id}/acuerdos`

Acuerdo del weekly (fecha real obligatoria)

| Parámetro | En | Tipo | Descripción |
|---|---|---|---|
| `id` (obligatorio) | ruta | string (uuid) |  |

**Cuerpo:** [Acuerdo](#acuerdo)

**Respuestas:**

- `201` Creado

### `POST /semanas/{id}/plan`

Generar Plan Operativo (markdown)

| Parámetro | En | Tipo | Descripción |
|---|---|---|---|
| `id` (obligatorio) | ruta | string (uuid) |  |
| `mesa` | query | string | uuid de la mesa |

**Respuestas:**

- `201` Acta

### `POST /semanas/{id}/acta`

Generar Acta de Cierre (markdown)

| Parámetro | En | Tipo | Descripción |
|---|---|---|---|
| `id` (obligatorio) | ruta | string (uuid) |  |
| `mesa` | query | string | uuid de la mesa |

**Respuestas:**

- `201` Acta

### `GET /semanas/daily`

Las tres señales del daily

**Respuestas:**

- `200` DailyView

## Esquemas

### Requerimiento

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `id` | string (uuid) | sí |  |
| `cliente_id` | string (uuid) | sí |  |
| `proyecto_id` | string (uuid) | sí | admite null |
| `bloque_nombre` | string | sí | admite null |
| `titulo_interno` | string | sí |  |
| `etiqueta_cliente` | string | sí | admite null |
| `visible_cliente` | boolean | sí |  |
| `tipo_trabajo` | `fee` · `proyecto` | sí |  |
| `estado_operativo` | `backlog` · `priorizado` · `en_ejecucion` · `en_revision` · `reprogramado` · `bloqueado` · `completado` · `cancelado` | sí |  |
| `estado_aprobacion` | `no_aplica` · `pendiente_interno` · `pendiente_cliente` · `aprobado` · `rechazado` | sí |  |
| `prioridad` | `alta` · `media` · `baja` | sí |  |
| `peso` | number | sí |  |
| `fecha_pedido` | string | sí | admite null; fecha YYYY-MM-DD |
| `fecha_entrega` | string | sí | admite null; fecha YYYY-MM-DD |
| `veces_reprogramado` | integer | sí |  |
| `owner_agencia` | lista de string (uuid) | sí |  |
| `piezas` | integer | sí |  |
| `basecamp_url` | string | sí | admite null |
| `fecha_entrega_original` | string | sí | admite null; fecha YYYY-MM-DD |
| `veces_reproceso` | integer | sí |  |
| `planificacion` | `planificado` · `no_planificado` · `urgente` | sí |  |
| `daily_fecha` | string | sí | admite null; fecha YYYY-MM-DD |
| `clase` | `tarea` · `propuesta` · `incidencia` |  |  |
| `proactiva` | boolean |  |  |
| `completado_at` | string | sí | admite null |
| `dias_atraso` | integer |  |  |
| `dias_sin_movimiento` | integer |  |  |

### CrearRequerimiento

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `cliente_id` | string (uuid) | sí |  |
| `proyecto_id` | string (uuid) |  | admite null |
| `titulo_interno` | string | sí | largo 2–300 |
| `etiqueta_cliente` | string |  | admite null |
| `visible_cliente` | boolean |  | por defecto `false` |
| `bloque_nombre` | string |  | admite null |
| `tipo_trabajo` | `fee` · `proyecto` |  | por defecto `"fee"` |
| `prioridad` | `alta` · `media` · `baja` |  | por defecto `"media"` |
| `peso` | number |  | mínimo 0; por defecto `1` |
| `fecha_pedido` | string |  | admite null |
| `fecha_entrega` | string |  | admite null |
| `owner_agencia` | lista de string (uuid) |  | por defecto `[]` |
| `piezas` | integer |  | mínimo 0; por defecto `0` |
| `planificacion` | `planificado` · `no_planificado` · `urgente` |  |  |
| `clase` | `tarea` · `propuesta` · `incidencia` |  |  |
| `proactiva` | boolean |  |  |

### ActualizarRequerimiento

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `titulo_interno` | string |  | largo 2–300 |
| `etiqueta_cliente` | string |  | admite null |
| `visible_cliente` | `false` |  |  |
| `estado_operativo` | `backlog` · `priorizado` · `en_ejecucion` · `en_revision` · `reprogramado` · `bloqueado` · `completado` · `cancelado` |  |  |
| `estado_aprobacion` | `no_aplica` · `pendiente_interno` · `pendiente_cliente` · `aprobado` · `rechazado` |  |  |
| `prioridad` | `alta` · `media` · `baja` |  |  |
| `peso` | number |  | mínimo 0 |
| `fecha_entrega` | string |  | admite null |
| `fecha_pedido` | string |  | admite null |
| `owner_agencia` | lista de string (uuid) |  |  |
| `owner_cliente` | lista de string |  | admite null |
| `piezas` | integer |  | mínimo 0 |
| `brief_url` | string (uri) |  | admite null |
| `entregable_urls` | lista de string (uri) |  | admite null |
| `motivo_reprogramacion` | `insumos_cliente` · `cambio_alcance` · `capacidad_equipo` · `prioridad_negocio` · `error_estimacion` · `reproceso` · `otro` |  | admite null |
| `observacion_reprogramacion` | string |  | admite null; largo 0–1000 |
| `planificacion` | `planificado` · `no_planificado` · `urgente` |  |  |
| `daily_fecha` | string |  | admite null |
| `clase` | `tarea` · `propuesta` · `incidencia` |  |  |
| `proactiva` | boolean |  |  |

### CrearProyecto

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `cliente_id` | string (uuid) | sí |  |
| `plantilla_id` | string (uuid) | sí |  |
| `nombre` | string | sí | largo 3–120 |
| `brief` | objeto | sí |  |
| `fecha_entrega` | string | sí |  |
| `fecha_inicio` | string |  |  |
| `prometio_cotizacion_id` | string (uuid) |  | admite null |
| `bloques` | lista de objeto |  | por defecto `[]` |
| `owner_ejecutiva` | string (uuid) |  | admite null |
| `repetir_mensual` | boolean |  |  |
| `periodo` | string |  | admite null |

### Proyecto

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `id` | string (uuid) | sí |  |
| `cliente_id` | string (uuid) | sí |  |
| `nombre` | string | sí |  |
| `estado` | `backlog` · `priorizado` · `en_ejecucion` · `en_revision` · `reprogramado` · `bloqueado` · `completado` · `cancelado` | sí |  |
| `fecha_inicio` | string | sí | fecha YYYY-MM-DD |
| `fecha_entrega` | string | sí | fecha YYYY-MM-DD |
| `avance` | number |  |  |
| `cliente_nombre` | string |  |  |
| `portal_activo` | boolean | sí |  |

### Cliente

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `id` | string (uuid) | sí |  |
| `nombre` | string | sí |  |
| `slug` | string | sí |  |
| `activo` | boolean | sí |  |
| `mesa_id` | string (uuid) | sí | admite null |

### Plantilla

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `id` | string (uuid) | sí |  |
| `nombre` | string | sí |  |
| `tipo` | string | sí |  |
| `descripcion` | string | sí | admite null |

### Senal

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `id` | string (uuid) | sí |  |
| `tipo` | string | sí |  |
| `severidad` | `critica` · `alta` · `media` | sí |  |
| `titulo` | string | sí |  |
| `atendida` | boolean | sí |  |
| `detalle` | objeto libre | sí |  |

### Acuerdo

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `descripcion` | string | sí | largo 3–∞ |
| `responsable_id` | string (uuid) | sí |  |
| `fecha_compromiso` | string | sí |  |

### ResumenCliente

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `cliente_id` | string (uuid) | sí |  |
| `proyectos_activos` | integer | sí |  |
| `requerimientos_atrasados` | integer | sí |  |
| `dias_sin_movimiento` | integer | sí |  |
| `esperando_cliente` | integer | sí |  |

### Error

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `error` | string | sí |  |
