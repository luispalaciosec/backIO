---
outline: [2, 3]
---

# Esquema de la base de datos

::: info Generado
Esta página se genera desde la base de producción con `pnpm --filter @backio/backend db:types`, el mismo comando que
genera los tipos del backend. Se corre después de aplicar cada migración. Las descripciones de las tablas se editan en
`backend/scripts/gen_tipos_db.ts`.
:::

Qué guarda cada tabla y sus columnas. Para entender cómo se relacionan y qué reglas protegen los datos, lee primero el
[modelo de datos](./01-modelo-datos.md). Todas las tablas tienen seguridad por fila (RLS); las de negocio llevan
`tenant_id`.

## Organización y personas

### tenants

Organizaciones. Hoy solo Geeks; toda tabla de negocio lleva su `tenant_id`.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `nombre` | texto | sí |  |
| `slug` | texto | sí |  |
| `config` | jsonb | sí |  |
| `activo` | boolean | sí | por defecto `true` |
| `created_at` | fecha y hora | sí | por defecto `now()` |
| `updated_at` | fecha y hora | sí | por defecto `now()` |
| `dominios_auto` | text[] | sí |  |

### usuarios

Personas con acceso: rol, capacidad semanal, área y su usuario de Basecamp.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `nombre` | texto | sí |  |
| `email` | texto | sí |  |
| `rol` | `admin` · `gerencia` · `operaciones` · `ejecutiva` · `lider` · `colaborador` | sí | por defecto `colaborador` |
| `avatar_url` | texto |  |  |
| `basecamp_user_id` | bigint |  |  |
| `capacidad_semanal` | integer | sí | por defecto `40` |
| `activo` | boolean | sí | por defecto `true` |
| `created_at` | fecha y hora | sí | por defecto `now()` |
| `updated_at` | fecha y hora | sí | por defecto `now()` |
| `area` | texto |  |  |
| `fecha_salida` | date |  |  |
| `motivo_salida` | texto |  |  |

### clientes

Clientes de la agencia (mismo id que en PrometIO), con su proyecto de Basecamp y su mesa.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `nombre` | texto | sí |  |
| `slug` | texto | sí |  |
| `logo_url` | texto |  |  |
| `color_primario` | texto |  | por defecto `#0073EA` |
| `basecamp_project_id` | bigint |  |  |
| `config` | jsonb | sí |  |
| `activo` | boolean | sí | por defecto `true` |
| `created_at` | fecha y hora | sí | por defecto `now()` |
| `updated_at` | fecha y hora | sí | por defecto `now()` |
| `created_by` | uuid |  | → [usuarios](#usuarios).id |
| `updated_by` | uuid |  | → [usuarios](#usuarios).id |
| `deleted_at` | fecha y hora |  |  |
| `mesa_id` | uuid |  | → [mesas](#mesas).id |
| `basecamp_importado_at` | fecha y hora |  |  |
| `es_prueba` | boolean | sí | por defecto `false` |

### mesas

Equipos de trabajo (Orión, Omega) con su proyecto y sus boards de Basecamp.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `nombre` | texto | sí |  |
| `slug` | texto | sí |  |
| `basecamp_project_id` | bigint |  |  |
| `lider_id` | uuid |  | → [usuarios](#usuarios).id |
| `color` | texto |  | por defecto `#0073EA` |
| `activa` | boolean | sí | por defecto `true` |
| `created_at` | fecha y hora | sí | por defecto `now()` |
| `updated_at` | fecha y hora | sí | por defecto `now()` |
| `basecamp_board_daily_id` | bigint |  |  |
| `basecamp_board_weekly_id` | bigint |  |  |

### invitaciones

Invitaciones pendientes para crear cuentas.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `email` | texto | sí |  |
| `nombre` | texto | sí |  |
| `rol` | `admin` · `gerencia` · `operaciones` · `ejecutiva` · `lider` · `colaborador` | sí | por defecto `colaborador` |
| `capacidad_semanal` | integer | sí | por defecto `40` |
| `usada_at` | fecha y hora |  |  |
| `created_at` | fecha y hora | sí | por defecto `now()` |
| `created_by` | uuid |  | → [usuarios](#usuarios).id |

## Trabajo

### proyectos

Proyectos de un cliente (una lista de to-dos en Basecamp), con fecha de entrega, brief y portal.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `cliente_id` | uuid | sí | → [clientes](#clientes).id |
| `plantilla_id` | uuid |  | → [plantillas](#plantillas).id |
| `prometio_cotizacion_id` | uuid |  |  |
| `nombre` | texto | sí |  |
| `brief` | jsonb | sí |  |
| `fecha_inicio` | date | sí |  |
| `fecha_entrega` | date | sí |  |
| `owner_ejecutiva` | uuid |  | → [usuarios](#usuarios).id |
| `estado` | `backlog` · `priorizado` · `en_ejecucion` · `en_revision` · `reprogramado` · `bloqueado` · `completado` · `cancelado` | sí | por defecto `priorizado` |
| `basecamp_todoset_id` | bigint |  |  |
| `basecamp_todolist_id` | bigint |  |  |
| `sync_estado` | `pendiente` · `ok` · `incompleto` | sí | por defecto `pendiente` |
| `portal_token` | texto |  |  |
| `portal_activo` | boolean | sí | por defecto `false` |
| `created_at` | fecha y hora | sí | por defecto `now()` |
| `updated_at` | fecha y hora | sí | por defecto `now()` |
| `created_by` | uuid |  | → [usuarios](#usuarios).id |
| `updated_by` | uuid |  | → [usuarios](#usuarios).id |
| `deleted_at` | fecha y hora |  |  |
| `mesa_id` | uuid |  | → [mesas](#mesas).id |
| `basecamp_grupos` | jsonb | sí |  |
| `valor_cotizado` | numeric |  |  |
| `recurrencia_id` | uuid |  | → [recurrencias](#recurrencias).id |
| `periodo` | texto |  |  |

### requerimientos

Las tareas del backlog: estado, aprobación, prioridad, fechas, responsables, visibilidad y enlace a Basecamp.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `cliente_id` | uuid | sí | → [clientes](#clientes).id |
| `proyecto_id` | uuid |  | → [proyectos](#proyectos).id |
| `bloque_nombre` | texto |  |  |
| `plantilla_tarea_id` | uuid |  | → [plantilla_tareas](#plantilla_tareas).id |
| `titulo_interno` | texto | sí |  |
| `etiqueta_cliente` | texto |  |  |
| `visible_cliente` | boolean | sí | por defecto `false` |
| `tipo_trabajo` | texto | sí | por defecto `fee` |
| `estado_operativo` | `backlog` · `priorizado` · `en_ejecucion` · `en_revision` · `reprogramado` · `bloqueado` · `completado` · `cancelado` | sí | por defecto `backlog` |
| `estado_aprobacion` | `no_aplica` · `pendiente_interno` · `pendiente_cliente` · `aprobado` · `rechazado` | sí | por defecto `no_aplica` |
| `prioridad` | `alta` · `media` · `baja` | sí | por defecto `media` |
| `peso` | numeric | sí | por defecto `1` |
| `fecha_pedido` | date |  |  |
| `fecha_entrega` | date |  |  |
| `fecha_entrega_original` | date |  |  |
| `veces_reprogramado` | integer | sí | por defecto `0` |
| `owner_agencia` | uuid[] | sí |  |
| `owner_cliente` | text[] |  |  |
| `piezas` | integer | sí | por defecto `0` |
| `brief_url` | texto |  |  |
| `entregable_urls` | text[] |  |  |
| `basecamp_todo_id` | bigint |  |  |
| `basecamp_todolist_id` | bigint |  |  |
| `basecamp_url` | texto |  |  |
| `ultima_actualizacion` | fecha y hora | sí | por defecto `now()` |
| `completado_at` | fecha y hora |  |  |
| `created_at` | fecha y hora | sí | por defecto `now()` |
| `updated_at` | fecha y hora | sí | por defecto `now()` |
| `created_by` | uuid |  | → [usuarios](#usuarios).id |
| `updated_by` | uuid |  | → [usuarios](#usuarios).id |
| `deleted_at` | fecha y hora |  |  |
| `tipo_pieza_id` | uuid |  | → [tipos_pieza](#tipos_pieza).id |
| `veces_reproceso` | integer | sí | por defecto `0` |
| `planificacion` | texto | sí | por defecto `planificado` |
| `daily_fecha` | date |  |  |
| `clase` | texto | sí | por defecto `tarea` |
| `proactiva` | boolean | sí | por defecto `false` |
| `primera_respuesta_at` | fecha y hora |  |  |
| `responsables_cierre` | uuid[] |  |  |
| `heredada` | boolean | sí | por defecto `false` |
| `basecamp_due_on_visto` | date |  |  |

### plantillas

Proyectos tipo que usa el Builder.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `nombre` | texto | sí |  |
| `descripcion` | texto |  |  |
| `tipo` | `campana` · `lanzamiento` · `fee_mensual` · `pieza_suelta` · `trade` | sí |  |
| `activa` | boolean | sí | por defecto `true` |
| `created_at` | fecha y hora | sí | por defecto `now()` |
| `updated_at` | fecha y hora | sí | por defecto `now()` |
| `recurrente` | boolean | sí | por defecto `false` |
| `patron_nombre` | texto |  |  |
| `pilar` | texto |  |  |
| `familia` | texto |  |  |
| `unidad` | texto |  |  |
| `precio_referencia` | texto |  |  |
| `cliente_id` | uuid |  | → [clientes](#clientes).id |

### plantilla_bloques

Bloques de una plantilla, con su peso.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `plantilla_id` | uuid | sí | → [plantillas](#plantillas).id |
| `nombre` | texto | sí |  |
| `peso` | numeric | sí |  |
| `orden` | integer | sí |  |
| `opcional` | boolean | sí | por defecto `false` |

### plantilla_tareas

Tareas de un bloque de plantilla, con su visibilidad por defecto y su desfase en días.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `bloque_id` | uuid | sí | → [plantilla_bloques](#plantilla_bloques).id |
| `titulo_interno` | texto | sí |  |
| `etiqueta_cliente` | texto |  |  |
| `visible_cliente_default` | boolean | sí | por defecto `false` |
| `peso_relativo` | numeric | sí | por defecto `1` |
| `dias_offset` | integer | sí | por defecto `0` |
| `rol_sugerido` | texto |  |  |
| `orden` | integer | sí |  |

### tipos_pieza

Formatos de entregable con su flujo de pasos (post, carrusel, reel…).

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `nombre` | texto | sí |  |
| `slug` | texto | sí |  |
| `esfuerzo` | numeric | sí | por defecto `1` |
| `pasos` | jsonb | sí |  |
| `activo` | boolean | sí | por defecto `true` |
| `created_at` | fecha y hora | sí | por defecto `now()` |
| `updated_at` | fecha y hora | sí | por defecto `now()` |

### recurrencias

Fees que generan el proyecto del mes siguiente el día configurado.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `cliente_id` | uuid | sí | → [clientes](#clientes).id |
| `plantilla_id` | uuid | sí | → [plantillas](#plantillas).id |
| `nombre_patron` | texto | sí |  |
| `brief` | jsonb | sí |  |
| `bloques` | jsonb | sí |  |
| `owner_ejecutiva` | uuid |  | → [usuarios](#usuarios).id |
| `dia_generacion` | integer | sí | por defecto `25` |
| `activa` | boolean | sí | por defecto `true` |
| `ultimo_mes_generado` | texto |  |  |
| `ultimo_proyecto_id` | uuid |  | → [proyectos](#proyectos).id |
| `proyecto_origen_id` | uuid |  | → [proyectos](#proyectos).id |
| `created_by` | uuid |  | → [usuarios](#usuarios).id |
| `created_at` | fecha y hora | sí | por defecto `now()` |
| `updated_at` | fecha y hora | sí | por defecto `now()` |

### proyecto_borradores

Borradores de proyecto creados por cotizaciones aprobadas en PrometIO.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `cliente_id` | uuid | sí | → [clientes](#clientes).id |
| `prometio_cotizacion_id` | uuid | sí |  |
| `plantilla_sugerida_id` | uuid |  | → [plantillas](#plantillas).id |
| `payload` | jsonb | sí |  |
| `estado` | texto | sí | por defecto `pendiente` |
| `proyecto_id` | uuid |  | → [proyectos](#proyectos).id |
| `created_at` | fecha y hora | sí | por defecto `now()` |

### mapeo_servicios

Servicio de PrometIO → plantilla sugerida para el borrador.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `servicio_prometio` | texto | sí |  |
| `plantilla_id` | uuid |  | → [plantillas](#plantillas).id |
| `bloque_nombre` | texto |  |  |
| `tipo_pieza_id` | uuid |  | → [tipos_pieza](#tipos_pieza).id |

### bitacora

Notas por tarea; algunas pueden ser visibles al cliente.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `requerimiento_id` | uuid | sí | → [requerimientos](#requerimientos).id |
| `usuario_id` | uuid |  | → [usuarios](#usuarios).id |
| `nota` | texto | sí |  |
| `estado_operativo` | texto |  |  |
| `estado_aprobacion` | texto |  |  |
| `visible_cliente` | boolean | sí | por defecto `false` |
| `created_at` | fecha y hora | sí | por defecto `now()` |

### notas_cuenta

Sin uso en el código: la reemplazó `bitacora`.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `requerimiento_id` | uuid | sí | → [requerimientos](#requerimientos).id |
| `autor_id` | uuid | sí | → [usuarios](#usuarios).id |
| `cuerpo` | texto | sí |  |
| `visible_cliente` | boolean | sí | por defecto `false` |
| `created_at` | fecha y hora | sí | por defecto `now()` |

### horas

Entradas del timesheet de Basecamp, atribuidas a cliente, tarea y persona.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `cliente_id` | uuid |  | → [clientes](#clientes).id |
| `requerimiento_id` | uuid |  | → [requerimientos](#requerimientos).id |
| `usuario_id` | uuid |  | → [usuarios](#usuarios).id |
| `basecamp_entry_id` | bigint | sí |  |
| `basecamp_person_id` | bigint |  |  |
| `basecamp_todo_id` | bigint |  |  |
| `basecamp_project_id` | bigint |  |  |
| `fecha` | date | sí |  |
| `horas` | numeric | sí |  |
| `sincronizado_at` | fecha y hora | sí | por defecto `now()` |

## Cumplimiento

### reprogramaciones

Cada cambio de fecha de entrega, con motivo, origen y a quién se atribuye.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `requerimiento_id` | uuid | sí | → [requerimientos](#requerimientos).id |
| `fecha_anterior` | date |  |  |
| `fecha_nueva` | date |  |  |
| `motivo` | texto |  |  |
| `origen` | texto | sí | por defecto `desconocido` |
| `usuario_id` | uuid |  | → [usuarios](#usuarios).id |
| `created_at` | fecha y hora | sí | por defecto `now()` |
| `observacion` | texto |  |  |

### reprocesos

Cada vez que una tarea se reabre (rechazo del cliente o completado reabierto).

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `requerimiento_id` | uuid | sí | → [requerimientos](#requerimientos).id |
| `origen` | texto | sí |  |
| `motivo` | texto |  |  |
| `paso_retorno` | texto |  |  |
| `fecha_entrega_antes` | date |  |  |
| `abierto_at` | fecha y hora | sí | por defecto `now()` |
| `cerrado_at` | fecha y hora |  |  |
| `horas_reproceso` | numeric |  |  |
| `usuario_id` | uuid |  | → [usuarios](#usuarios).id |
| `created_at` | fecha y hora | sí | por defecto `now()` |
| `observacion` | texto |  |  |
| `area_responsable` | texto |  |  |
| `atribuible` | texto |  |  |

### aprobacion_eventos

Cada cambio de estado de aprobación, con su ronda (alimenta KPIs).

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `requerimiento_id` | uuid | sí | → [requerimientos](#requerimientos).id |
| `estado_de` | texto |  |  |
| `estado_a` | texto | sí |  |
| `ronda` | integer | sí | por defecto `1` |
| `usuario_id` | uuid |  |  |
| `created_at` | fecha y hora | sí | por defecto `now()` |

## Rituales

### semanas

Semanas ISO del weekly, con marcas de plan y acta publicados.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `anio` | integer | sí |  |
| `numero_iso` | integer | sí |  |
| `fecha_inicio` | date | sí |  |
| `fecha_fin` | date | sí |  |
| `plan_publicado_at` | fecha y hora |  |  |
| `acta_publicada_at` | fecha y hora |  |  |
| `created_at` | fecha y hora | sí | por defecto `now()` |
| `plan_publicado_por_mesa` | jsonb | sí |  |

### senales

Alertas calculadas por el motor de señales para una semana.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `semana_id` | uuid | sí | → [semanas](#semanas).id |
| `tipo` | texto | sí |  |
| `severidad` | texto | sí |  |
| `entidad_tipo` | texto | sí |  |
| `entidad_id` | uuid | sí |  |
| `titulo` | texto | sí |  |
| `detalle` | jsonb | sí |  |
| `atendida` | boolean | sí | por defecto `false` |
| `created_at` | fecha y hora | sí | por defecto `now()` |
| `atendida_por` | uuid |  | → [usuarios](#usuarios).id |
| `atendida_at` | fecha y hora |  |  |

### acuerdos

Compromisos del weekly con responsable y fecha.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `semana_id` | uuid | sí | → [semanas](#semanas).id |
| `descripcion` | texto | sí |  |
| `responsable_id` | uuid | sí | → [usuarios](#usuarios).id |
| `fecha_compromiso` | date | sí |  |
| `estado` | texto | sí | por defecto `pendiente` |
| `cerrado_at` | fecha y hora |  |  |
| `created_at` | fecha y hora | sí | por defecto `now()` |
| `created_by` | uuid |  | → [usuarios](#usuarios).id |
| `mesa_id` | uuid |  | → [mesas](#mesas).id |

### actas

Plan Operativo, Acta de Cierre e informe mensual: el texto y si se publicó.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `semana_id` | uuid | sí | → [semanas](#semanas).id |
| `tipo` | texto | sí |  |
| `contenido` | jsonb | sí |  |
| `markdown` | texto | sí |  |
| `publicado_at` | fecha y hora |  |  |
| `publicado_por` | uuid |  | → [usuarios](#usuarios).id |
| `basecamp_doc_id` | bigint |  |  |
| `created_at` | fecha y hora | sí | por defecto `now()` |
| `mesa_id` | uuid |  | → [mesas](#mesas).id |

### daily_snapshots

Foto diaria de cada mesa (evolutivo).

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `mesa_id` | uuid | sí | → [mesas](#mesas).id |
| `fecha` | date | sí |  |
| `metricas` | jsonb | sí |  |
| `seleccion` | uuid[] | sí |  |
| `por_persona` | jsonb | sí |  |
| `origen` | texto | sí |  |
| `publicado` | boolean | sí | por defecto `false` |
| `apertura_publicada` | boolean | sí | por defecto `false` |
| `message_id` | bigint |  |  |
| `created_at` | fecha y hora | sí | por defecto `now()` |
| `updated_at` | fecha y hora | sí | por defecto `now()` |

### weekly_snapshots

Foto semanal de cada mesa (evolutivo).

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `mesa_id` | uuid | sí | → [mesas](#mesas).id |
| `semana_id` | uuid | sí | → [semanas](#semanas).id |
| `fecha_inicio` | date | sí |  |
| `fecha_fin` | date | sí |  |
| `metricas` | jsonb | sí |  |
| `origen` | texto | sí |  |
| `created_at` | fecha y hora | sí | por defecto `now()` |
| `updated_at` | fecha y hora | sí | por defecto `now()` |

## KPIs

### kpi_definiciones

Cada KPI: área, cálculo, meta y operador.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `codigo` | texto | sí |  |
| `area` | texto | sí |  |
| `indicador` | texto | sí |  |
| `periodicidad` | texto | sí | por defecto `mensual` |
| `operador` | texto | sí | por defecto `>=` |
| `meta` | numeric | sí |  |
| `tipo` | texto | sí | por defecto `porcentaje` |
| `numerador_label` | texto | sí |  |
| `denominador_label` | texto | sí |  |
| `denominador_fijo` | numeric |  |  |
| `calculo` | texto | sí | por defecto `manual` |
| `fuente` | texto |  |  |
| `regla` | texto |  |  |
| `formula` | texto |  |  |
| `activo` | boolean | sí | por defecto `true` |
| `orden` | integer | sí | por defecto `0` |
| `created_at` | fecha y hora | sí | por defecto `now()` |
| `updated_at` | fecha y hora | sí | por defecto `now()` |

### kpi_mediciones

Resultado de un KPI por periodo y persona o equipo (automático, congelado o ajustado).

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `kpi_id` | uuid | sí | → [kpi_definiciones](#kpi_definiciones).id |
| `periodo` | texto | sí |  |
| `usuario_id` | uuid |  | → [usuarios](#usuarios).id |
| `dato_a` | numeric |  |  |
| `dato_b` | numeric |  |  |
| `meta_individual` | numeric |  |  |
| `origen` | texto | sí | por defecto `manual` |
| `justificacion_ajuste` | texto |  |  |
| `tasa_respuesta` | numeric |  |  |
| `causa` | texto |  |  |
| `atribuible` | texto |  |  |
| `evidencia_url` | texto |  |  |
| `plan_mejora` | texto |  |  |
| `responsable_id` | uuid |  | → [usuarios](#usuarios).id |
| `fecha_seguimiento` | date |  |  |
| `registrado_por` | uuid |  | → [usuarios](#usuarios).id |
| `created_at` | fecha y hora | sí | por defecto `now()` |
| `updated_at` | fecha y hora | sí | por defecto `now()` |

## Basecamp

### basecamp_huerfanos

To-dos de Basecamp sin tarea en BackIO: pendientes, adoptados o ignorados.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `cliente_id` | uuid | sí | → [clientes](#clientes).id |
| `basecamp_project_id` | bigint | sí |  |
| `basecamp_todolist_id` | bigint |  |  |
| `basecamp_todo_id` | bigint | sí |  |
| `titulo` | texto | sí |  |
| `creador_basecamp_id` | bigint |  |  |
| `creador_nombre` | texto |  |  |
| `due_on` | date |  |  |
| `completed` | boolean | sí | por defecto `false` |
| `app_url` | texto |  |  |
| `detectado_at` | fecha y hora | sí | por defecto `now()` |
| `resuelto_at` | fecha y hora |  |  |
| `resolucion` | texto |  |  |
| `requerimiento_id` | uuid |  | → [requerimientos](#requerimientos).id |

### integracion_credenciales

Tokens de Basecamp. Sin políticas: solo la lee el servidor.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `tenant_id` | uuid | sí | clave primaria; → [tenants](#tenants).id |
| `proveedor` | texto | sí | clave primaria |
| `datos` | jsonb | sí |  |
| `updated_at` | fecha y hora | sí | por defecto `now()` |

## Portal del cliente

### portal_pines

PIN del portal por cliente, guardado con hash. Solo lo lee el servidor.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `cliente_id` | uuid | sí | clave primaria; → [clientes](#clientes).id |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `hash` | texto | sí |  |
| `updated_at` | fecha y hora | sí | por defecto `now()` |

### portal_resumenes

Caché del resumen ejecutivo que redacta la IA para el portal.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `proyecto_id` | uuid | sí | clave primaria; → [proyectos](#proyectos).id |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `payload_hash` | texto | sí |  |
| `resumen` | texto | sí |  |
| `generado_at` | fecha y hora | sí | por defecto `now()` |

## IA, agentes y acceso

### ia_generaciones

Registro y caché de cada texto que redactó la IA (tokens usados, quién lo pidió).

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `tipo` | texto | sí |  |
| `entidad_tipo` | texto |  |  |
| `entidad_id` | texto |  |  |
| `payload_hash` | texto | sí |  |
| `texto` | texto | sí |  |
| `datos` | jsonb |  |  |
| `modelo` | texto | sí |  |
| `tokens_entrada` | integer |  |  |
| `tokens_salida` | integer |  |  |
| `creado_por` | uuid |  | → [usuarios](#usuarios).id |
| `created_at` | fecha y hora | sí | por defecto `now()` |

### api_keys

Claves de API (solo el hash), con perfil, scopes y, si es de un cliente, a qué cliente pertenece.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `nombre` | texto | sí |  |
| `prefijo` | texto | sí |  |
| `key_hash` | texto | sí |  |
| `scopes` | text[] | sí |  |
| `perfil` | texto |  |  |
| `creado_por` | uuid |  | → [usuarios](#usuarios).id |
| `ultimo_uso_at` | fecha y hora |  |  |
| `revocada_at` | fecha y hora |  |  |
| `created_at` | fecha y hora | sí | por defecto `now()` |
| `cliente_id` | uuid |  | → [clientes](#clientes).id |

### agent_plans

Planes de cambios que proponen los agentes por MCP, a la espera de confirmación.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | texto | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `api_key_id` | uuid |  | → [api_keys](#api_keys).id |
| `tool` | texto | sí |  |
| `parametros` | jsonb | sí |  |
| `plan` | jsonb | sí |  |
| `expira_at` | fecha y hora | sí |  |
| `ejecutado_at` | fecha y hora |  |  |
| `resultado` | jsonb |  |  |
| `created_at` | fecha y hora | sí | por defecto `now()` |
| `usuario_id` | uuid |  | → [usuarios](#usuarios).id |

### oauth_clients

Agentes registrados por OAuth.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | texto | sí | clave primaria |
| `secret_hash` | texto |  |  |
| `nombre` | texto | sí |  |
| `redirect_uris` | text[] | sí |  |
| `metadata` | jsonb | sí |  |
| `created_at` | fecha y hora | sí | por defecto `now()` |

### oauth_codes

Códigos de autorización OAuth de corta vida.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `code` | texto | sí | clave primaria |
| `client_id` | texto | sí | → [oauth_clients](#oauth_clients).id |
| `redirect_uri` | texto | sí |  |
| `code_challenge` | texto | sí |  |
| `scope` | texto | sí | por defecto `` |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `usuario_id` | uuid | sí | → [usuarios](#usuarios).id |
| `expira_at` | fecha y hora | sí |  |
| `usado_at` | fecha y hora |  |  |
| `created_at` | fecha y hora | sí | por defecto `now()` |

### oauth_tokens

Tokens de acceso y renovación de los agentes OAuth.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `token_hash` | texto | sí | clave primaria |
| `tipo` | texto | sí |  |
| `client_id` | texto | sí | → [oauth_clients](#oauth_clients).id |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `usuario_id` | uuid | sí | → [usuarios](#usuarios).id |
| `scope` | texto | sí | por defecto `` |
| `expira_at` | fecha y hora | sí |  |
| `revocado_at` | fecha y hora |  |  |
| `created_at` | fecha y hora | sí | por defecto `now()` |

## Sistema

### audit_log

Quién hizo qué y cuándo. Lo leen Admin → Auditoría y el Día a día.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | bigint | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `sistema` | texto | sí | por defecto `backio` |
| `usuario_id` | uuid |  | → [usuarios](#usuarios).id |
| `api_key_id` | uuid |  | → [api_keys](#api_keys).id |
| `origen` | texto | sí |  |
| `accion` | texto | sí |  |
| `entidad` | texto | sí |  |
| `entidad_id` | uuid |  |  |
| `detalle` | jsonb |  |  |
| `created_at` | fecha y hora | sí | por defecto `now()` |

### notificaciones

Cola de correos y avisos por persona.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `usuario_id` | uuid |  | → [usuarios](#usuarios).id |
| `canal` | texto | sí | por defecto `pendiente` |
| `tipo` | texto | sí |  |
| `titulo` | texto | sí |  |
| `cuerpo` | texto |  |  |
| `entidad_tipo` | texto |  |  |
| `entidad_id` | uuid |  |  |
| `enviada_at` | fecha y hora |  |  |
| `leida_at` | fecha y hora |  |  |
| `created_at` | fecha y hora | sí | por defecto `now()` |
| `email_destino` | texto |  |  |
| `intentos` | integer | sí | por defecto `0` |
| `ultimo_error` | texto |  |  |

### limites

Contadores del límite de peticiones (login, PIN, OAuth, MCP). Tabla global, sin `tenant_id`.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `clave` | texto | sí | clave primaria |
| `ventana_inicio` | fecha y hora | sí |  |
| `n` | integer | sí | por defecto `0` |
| `bloqueado_hasta` | fecha y hora |  |  |

### cron_runs

Cada corrida de cada tarea programada (y los avisos del vigía). Tabla global, sin `tenant_id`.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `job` | texto | sí | clave primaria |
| `ventana` | texto | sí | clave primaria |
| `inicio_at` | fecha y hora | sí | por defecto `now()` |
| `fin_at` | fecha y hora |  |  |
| `ok` | boolean |  |  |
| `detalle` | texto |  |  |

## Vistas

### v_requerimientos_metricas

Requerimientos con días de atraso y días sin movimiento calculados (hora de Guayaquil).

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | uuid |  | clave primaria |
| `tenant_id` | uuid |  | → [tenants](#tenants).id |
| `cliente_id` | uuid |  | → [clientes](#clientes).id |
| `proyecto_id` | uuid |  | → [proyectos](#proyectos).id |
| `bloque_nombre` | texto |  |  |
| `plantilla_tarea_id` | uuid |  | → [plantilla_tareas](#plantilla_tareas).id |
| `titulo_interno` | texto |  |  |
| `etiqueta_cliente` | texto |  |  |
| `visible_cliente` | boolean |  |  |
| `tipo_trabajo` | texto |  |  |
| `estado_operativo` | `backlog` · `priorizado` · `en_ejecucion` · `en_revision` · `reprogramado` · `bloqueado` · `completado` · `cancelado` |  |  |
| `estado_aprobacion` | `no_aplica` · `pendiente_interno` · `pendiente_cliente` · `aprobado` · `rechazado` |  |  |
| `prioridad` | `alta` · `media` · `baja` |  |  |
| `peso` | numeric |  |  |
| `fecha_pedido` | date |  |  |
| `fecha_entrega` | date |  |  |
| `fecha_entrega_original` | date |  |  |
| `veces_reprogramado` | integer |  |  |
| `owner_agencia` | uuid[] |  |  |
| `owner_cliente` | text[] |  |  |
| `piezas` | integer |  |  |
| `brief_url` | texto |  |  |
| `entregable_urls` | text[] |  |  |
| `basecamp_todo_id` | bigint |  |  |
| `basecamp_todolist_id` | bigint |  |  |
| `basecamp_url` | texto |  |  |
| `ultima_actualizacion` | fecha y hora |  |  |
| `completado_at` | fecha y hora |  |  |
| `created_at` | fecha y hora |  |  |
| `updated_at` | fecha y hora |  |  |
| `created_by` | uuid |  | → [usuarios](#usuarios).id |
| `updated_by` | uuid |  | → [usuarios](#usuarios).id |
| `deleted_at` | fecha y hora |  |  |
| `tipo_pieza_id` | uuid |  | → [tipos_pieza](#tipos_pieza).id |
| `veces_reproceso` | integer |  |  |
| `planificacion` | texto |  |  |
| `daily_fecha` | date |  |  |
| `clase` | texto |  |  |
| `proactiva` | boolean |  |  |
| `primera_respuesta_at` | fecha y hora |  |  |
| `responsables_cierre` | uuid[] |  |  |
| `heredada` | boolean |  |  |
| `dias_atraso` | integer |  |  |
| `dias_sin_movimiento` | integer |  |  |
| `peso_completado` | numeric |  |  |

### v_proyectos_avance

Avance de cada proyecto según el peso de sus tareas completadas.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `proyecto_id` | uuid |  | clave primaria |
| `tenant_id` | uuid |  | → [tenants](#tenants).id |
| `cliente_id` | uuid |  | → [clientes](#clientes).id |
| `peso_total` | numeric |  |  |
| `peso_completado` | numeric |  |  |
| `avance` | integer |  |  |
| `atrasados` | bigint |  |  |
| `esperando_cliente` | bigint |  |  |

## Sin clasificar

### requerimiento_responsables

Sin descripción: agrégala en `backend/scripts/gen_tipos_db.ts`.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `id` | bigint | sí | clave primaria |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `requerimiento_id` | uuid | sí | → [requerimientos](#requerimientos).id |
| `usuario_id` | uuid | sí | → [usuarios](#usuarios).id |
| `desde` | fecha y hora | sí | por defecto `now()` |
| `hasta` | fecha y hora |  |  |
| `motivo` | texto |  |  |

### basecamp_credenciales_usuario

Sin descripción: agrégala en `backend/scripts/gen_tipos_db.ts`.

| Columna | Tipo | Obligatoria | Notas |
|---|---|---|---|
| `usuario_id` | uuid | sí | clave primaria; → [usuarios](#usuarios).id |
| `tenant_id` | uuid | sí | → [tenants](#tenants).id |
| `basecamp_person_id` | bigint | sí |  |
| `datos` | jsonb | sí |  |
| `conectado_at` | fecha y hora | sí | por defecto `now()` |
| `updated_at` | fecha y hora | sí | por defecto `now()` |
