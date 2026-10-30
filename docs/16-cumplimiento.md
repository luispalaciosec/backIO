# 16 · Cumplimiento: reprogramaciones y reprocesos

> Revisado contra el código el 11/10/2026.

> Aprobado por Luis el 04/09/2026 (siguió las recomendaciones propuestas). Migración `20260904000015`.

## Principio

La fecha comprometida en la apertura de mesa **no se pierde nunca**: `fecha_entrega_original` se fija al crear
la tarea y no cambia. Cada cambio de `fecha_entrega` queda en `reprogramaciones` (trigger de base de datos) y
cada vuelta al equipo queda en `reprocesos`. Solo se registran **motivos de catálogo y paso de retorno**;
nunca el texto del comentario del cliente o del equipo (regla 1).

## Reprogramación

- Desde la UI el **motivo es obligatorio** (modal al cambiar la fecha en backlog o Kanban). El MCP también lo
  exige: `plan_requirement_update` no genera el plan sin motivo. Solo una llamada a la API REST que no viene de la
  pantalla puede omitirlo (`exigirMotivo` en `backend/src/lib/requerimientos/actualizar.ts`). En ese caso la fila
  queda "sin causa" y aparece como señal `reprogramacion_sin_motivo` y en el panel "Causas pendientes" del
  Weekly, donde se completa con un clic.
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
- Catálogo (`MOTIVOS_REPROCESO` en `shared/src/types.ts`): brief incompleto o ambiguo (ejecutiva), info
  incompleta o incorrecta del levantamiento (ejecutiva), error de ejecución (equipo), cambio de opinión del
  cliente (cliente), ajuste de marca o legal (cliente), dirección de arte (líder), error de texto (equipo).
- Idempotente por tarea: mientras hay un reproceso abierto no se crea otro (el webhook `todo_uncompleted`
  que vuelve tras reabrir desde BackIO no duplica).

## Observación (07/09/2026)

Reprocesos y reprogramaciones admiten una **observación** libre escrita en BackIO por el equipo (máx. 1000
caracteres). Es texto propio de BackIO, no copiado de Basecamp, y nunca llega al portal del cliente. Migración
`20260907000017`, ya aplicada. Mientras no estaba aplicada, el backend guardaba sin observación; ese respaldo ya
no existe en el código.

## Entrega declarada (30/10/2026)

Para «a tiempo», la fecha real de entrega es la que declara el responsable al responder «¿ya se entregó?»
(`entregado_el`, migración 38) y, si no la declaró, el día de cierre. Una tarea entregada a tiempo y cerrada tarde en
Basecamp ya no cuenta como tarde. Ver [Mi día y avisos](./22-avisos.md).

## Indicadores

| Indicador | Cálculo | Dónde |
|---|---|---|
| A tiempo (original) | `cerradaATiempo(completado_at, fecha_entrega_original)` | KPI, cliente, persona, informe, serie semanal |
| A tiempo (vigente) | `cerradaATiempo(completado_at, fecha_entrega)` | KPI secundario, persona (tooltip), informe |
| Desvío | mediana de días entre fecha original y entrega real (solo tardías) | persona |
| Reprogramaciones del equipo | filas con motivo atribuible `equipo` | persona |
| Reprocesos y horas de reproceso | filas de `reprocesos` y suma de `horas_reproceso` | KPI, cliente, persona, informe |
| Causa dominante | motivo más frecuente | persona (tooltip), informe |

«A tiempo» tiene una sola definición: la función `cerradaATiempo` de `shared/src/metricas.ts`. Toma el día de
cierre en hora de Guayaquil y lo compara con la fecha comprometida, incluyendo ese día. La usan cumplimiento,
KPIs, evolutivo, dashboard, personas e informes. Ejemplo: una tarea con fecha 15/10 cerrada el 15/10 a las 19:30
está a tiempo; cerrada el 16/10 a las 00:30 está tarde.

Cuando alguien se va ([Cuando alguien se va](./20-salida.md)):

- Una tarea **heredada** (la recibió otra persona con menos de 3 días hábiles para la entrega, o vencida) que se
  cierra tarde da `null` en `cerradaATiempo`: queda fuera del porcentaje, ni a tiempo ni tarde.
- Por persona, lo completado cuenta para sus responsables al cierre (`responsablesDe`). Una reprogramación o un
  reproceso cuenta para quien tenía la tarea **en ese momento**, según el historial `requerimiento_responsables`
  (`responsablesEn`); en tareas anteriores a la migración 30, para sus responsables actuales.

Señales nuevas del Weekly: `reproceso_reincidente` (crítica, ≥ 2 reprocesos), `reprogramacion_sin_motivo` y
`reproceso_sin_motivo` (media). Causa de agenda IA: "Calidad y reprocesos" / "Causas pendientes de registrar".

## Endpoints

```
PATCH /requerimientos/:id                       + motivo_reprogramacion (obligatorio desde UI si cambia fecha_entrega)
GET   /requerimientos/:id/historial             → { reprogramaciones, reprocesos }
POST  /requerimientos/:id/reprocesos            { origen, motivo, paso_retorno?, observacion?, reabrir_basecamp,
                                                  area_responsable?, atribuible? }
PATCH /requerimientos/:id/reprocesos/:rid       { motivo?, paso_retorno?, observacion?, area_responsable?, atribuible? }
POST  /requerimientos/:id/reprocesos/:rid/cerrar
PATCH /requerimientos/reprogramaciones/:rid     { motivo, observacion? }
GET   /requerimientos/causas-pendientes         (últimos 45 días sin motivo)
```

`area_responsable` admite `cuentas`, `produccion`, `diseno`, `creatividad` o `content`. `atribuible` admite
`equipo`, `cliente` o `externo`. La lista completa de rutas está en la [referencia de la API](./referencia-api.md).

Colaboradores: pueden reprogramar (con motivo), registrar y cerrar reprocesos solo en sus tareas.

## Bitácora por tarea y estatus por cliente (23/09/2026)

Las ejecutivas llevaban con el cliente una hoja "Control de tareas" (campaña, tarea, status, observación fechada por
reunión). Eso ahora vive en BackIO:

- **`bitacora`** (migración 20): nota fechada por requerimiento con quién la escribió y el estado operativo y de
  aprobación del momento. `visible_cliente` solo tiene efecto si la tarea es `visible_cliente` (regla 2: nunca abre lo
  oculto). Se anota desde el historial ↺ (pestaña Bitácora) y desde la columna **Observación** del backlog, que muestra
  la última nota. Rutas: `GET/POST /requerimientos/:id/bitacora`, `DELETE /requerimientos/:id/bitacora/:bid`,
  `GET /requerimientos/bitacora/ultimas`.
- **Estatus por cliente** (`/informes/estatus`, `GET /requerimientos/estatus?cliente&desde&hasta`): la hoja de la
  reunión, por proyecto, con tarea, responsable, entrega, estado, aprobación y la última observación hasta la fecha
  `hasta` (así la semana pasada se reconstruye tal cual se presentó). Imprimible en A4 horizontal. Acceso desde el
  encabezado de cada cliente en el backlog («📝 Estatus») y desde Informes.
- Pendiente (zona de revisión humana `lib/visibility/`): mostrar en el portal las notas `visible_cliente` de tareas
  visibles.
