# 16 · Cumplimiento: reprogramaciones y reprocesos

> Aprobado por Luis el 04/09/2026 (siguió las recomendaciones propuestas). Migración `20260904000015`.

## Principio

La fecha comprometida en la apertura de mesa **no se pierde nunca**: `fecha_entrega_original` se fija al crear
la tarea y no cambia. Cada cambio de `fecha_entrega` queda en `reprogramaciones` (trigger de base de datos) y
cada vuelta al equipo queda en `reprocesos`. Solo se registran **motivos de catálogo y paso de retorno**;
nunca el texto del comentario del cliente o del equipo (regla 1).

## Reprogramación

- Desde la UI el **motivo es obligatorio** (modal al cambiar la fecha en backlog o Kanban). API y MCP pueden
  omitirlo: la fila queda "sin causa" y aparece como señal `reprogramacion_sin_motivo` y en el panel
  "Causas pendientes" del Weekly, donde se completa con un clic.
- Catálogo y atribución (`MOTIVOS_REPROGRAMACION` en `shared`):

| Motivo | Atribuible a |
|---|---|
| Insumos o aprobación del cliente | cliente |
| Cambio de alcance | cliente |
| Capacidad del equipo | **equipo** |
| Prioridad de negocio | neutro |
| Error de estimación | **equipo** |
| Reproceso | **equipo** |
| Otro | neutro |

- Solo las atribuibles al equipo descuentan a la persona en el dashboard (`Reprog.`).

## Reproceso

- Se registra desde el botón ↺ de la fila (origen cliente o revisión interna, causa, paso al que vuelve,
  reabrir en Basecamp), automáticamente cuando la aprobación pasa a **Rechazado**, cuando una tarea completada
  se reabre desde BackIO, o cuando **Basecamp desmarca** un to-do completado (origen `basecamp`, sin causa).
- Efecto: contador `veces_reproceso`, tarea a "En ejecución", aprobación a "Rechazado" (cliente) o
  "Pendiente interno", y si tiene to-do enlazado y estaba completado, `DELETE completion` en Basecamp
  (`lib/basecamp/write.ts › reabrirTodo`, zona de revisión humana).
- Se cierra con "Entregado de nuevo" en el historial, o solo cuando el to-do se completa en Basecamp / la tarea
  pasa a completado. Al cerrar se guardan las **horas del timesheet** consumidas desde la apertura.
- Catálogo (`MOTIVOS_REPROCESO`): brief incompleto (ejecutiva), error de ejecución (equipo), cambio de opinión
  del cliente (cliente), ajuste de marca o legal (cliente), dirección de arte (líder), error de texto (equipo).
- Idempotente por tarea: mientras hay un reproceso abierto no se crea otro (el webhook `todo_uncompleted`
  que vuelve tras reabrir desde BackIO no duplica).

## Observación (07/09/2026)

Reprocesos y reprogramaciones admiten una **observación** libre escrita en BackIO por el equipo (máx. 1000
caracteres). Es texto propio de BackIO, no copiado de Basecamp, y nunca llega al portal del cliente. Migración
`20260907000017`; el backend tolera la columna ausente (guarda sin observación) hasta que se aplique.

## Indicadores

| Indicador | Cálculo | Dónde |
|---|---|---|
| A tiempo (original) | `completado_at <= fecha_entrega_original` | KPI, cliente, persona, informe, serie semanal |
| A tiempo (vigente) | `completado_at <= fecha_entrega` | KPI secundario, persona (tooltip), informe |
| Desvío | mediana de días entre fecha original y entrega real (solo tardías) | persona |
| Reprogramaciones del equipo | filas con motivo atribuible `equipo` | persona |
| Reprocesos y horas de reproceso | filas de `reprocesos` y suma de `horas_reproceso` | KPI, cliente, persona, informe |
| Causa dominante | motivo más frecuente | persona (tooltip), informe |

Señales nuevas del Weekly: `reproceso_reincidente` (crítica, ≥ 2 reprocesos), `reprogramacion_sin_motivo` y
`reproceso_sin_motivo` (media). Causa de agenda IA: "Calidad y reprocesos" / "Causas pendientes de registrar".

## Endpoints

```
PATCH /requerimientos/:id                       + motivo_reprogramacion (obligatorio desde UI si cambia fecha_entrega)
GET   /requerimientos/:id/historial             → { reprogramaciones, reprocesos }
POST  /requerimientos/:id/reprocesos            { origen, motivo, paso_retorno?, reabrir_basecamp }
PATCH /requerimientos/:id/reprocesos/:rid       { motivo?, paso_retorno? }
POST  /requerimientos/:id/reprocesos/:rid/cerrar
PATCH /requerimientos/reprogramaciones/:rid     { motivo }
GET   /requerimientos/causas-pendientes         (últimos 45 días sin motivo)
```

Colaboradores: pueden reprogramar (con motivo), registrar y cerrar reprocesos solo en sus tareas.
