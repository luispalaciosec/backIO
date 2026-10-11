# Glosario

Las palabras del dominio tal como se usan en BackIO. Entre paréntesis, el nombre técnico cuando difiere.

## Trabajo

**Requerimiento** (`requerimientos`). Una tarea del backlog. En la interfaz se dice «tarea». Puede estar enlazada a un
to-do de Basecamp (`basecamp_todo_id`).

**Proyecto** (`proyectos`). Un conjunto de tareas de un cliente con fecha de entrega: una campaña o el mes de un fee.
Equivale a una lista de to-dos (*todolist*) de Basecamp.

**Bloque.** Un grupo de tareas dentro de un proyecto (por ejemplo, «Producción»). Equivale a un grupo dentro de la lista
de Basecamp.

**Plantilla.** Un proyecto tipo, con bloques, tareas, pesos y visibilidad por defecto. El Builder crea proyectos a partir
de una plantilla.

**Tipo de pieza.** Un formato de entregable con su flujo de pasos (post, carrusel, reel…). Un reel pasa por idea,
guion, storyboard, grabación, edición y posteo.

**Piezas.** Cuántas unidades produce una tarea. Alimentan los KPIs de producción y el informe por canal.

**Peso.** Cuánto pesa una tarea dentro de su proyecto para calcular el avance.

**Fee.** Un cliente con trabajo mensual recurrente (`tipo_trabajo = fee`), en contraste con un proyecto puntual.

**Recurrencia.** La regla que genera el proyecto del mes siguiente de un fee a partir de una plantilla
(Admin → Recurrencias).

**Clase.** Si una tarea es una tarea común, una **propuesta** (cuenta para campañas aprobadas) o una **incidencia**
(tiene SLA de resolución). Se marca con `[PROPUESTA]` o `[INCIDENCIA]` en el título del to-do.

**Proactiva.** Una propuesta que el cliente no pidió. Se marca con `[PROACTIVA]` en el título.

## Estados

**Estado operativo.** En qué punto está el trabajo: backlog, priorizado, en proceso (`en_ejecucion`), en revisión,
reprogramado, bloqueado, completado o cancelado. Lo maneja BackIO, salvo «completado», que manda Basecamp.

**Estado de aprobación.** En qué punto está la aprobación: sin estado (`no_aplica`), pendiente interno, pendiente
cliente, aprobado o «cambios solicitados» (`rechazado`). Un rechazo del cliente abre un reproceso.

**Planificación.** Cómo entró la tarea a la semana: **planificada** (salió del weekly), **no planificada** (entró
durante la semana) o **urgente**.

## Cumplimiento

**Fecha original** (`fecha_entrega_original`). La primera fecha comprometida. No cambia aunque la tarea se reprograme.

**Fecha vigente** (`fecha_entrega`). La fecha comprometida hoy.

**Reprogramación.** Un cambio de la fecha de entrega. Desde la pantalla exige un motivo, y el motivo dice a quién se
atribuye: al equipo, al cliente o a un tercero.

**Reproceso.** Una tarea que vuelve a abrirse: el cliente pidió cambios o un completado se reabrió.

**A tiempo.** Una tarea cerrada el mismo día de su fecha comprometida o antes, contando el día en hora de Guayaquil.
Cerrar a las 19:30 del día de entrega es a tiempo; a las 00:30 del día siguiente, no. Hay una sola definición para
todo el sistema (`cerradaATiempo`).

## Rituales

**Mesa.** Un equipo de trabajo con sus clientes (hoy Orión y Omega). Cada mesa tiene su proyecto en Basecamp, con los
boards de Daily y Weekly.

**Weekly.** La reunión semanal de la mesa. Allí se revisan las señales, se cierran acuerdos y se arma el Plan Operativo.

**Daily.** La revisión diaria de la mesa: la apertura (qué se trabaja hoy) y el cierre (qué se completó). Se publica en
el board Daily de Basecamp.

**Selección del daily** (`daily_fecha`). Las tareas que la mesa decidió trabajar hoy. Una tarea sin responsable no
entra.

**Señal.** Una alerta que calcula el motor de señales para el weekly (compromiso vencido, bloqueo del cliente, tarea sin
movimiento…).

**Acuerdo.** Un compromiso del weekly, con responsable y fecha concreta.

**Acta.** Un documento de la semana: el **Plan Operativo**, el **Acta de Cierre** o el **informe mensual**. La IA lo
redacta y una persona lo publica.

**Evolutivo.** Las fotos diarias y semanales de cada mesa, para ver la tendencia de los rituales.

**KPI.** Un indicador por persona o por área, con su meta. La mayoría se calcula solo; algunos se registran a mano.

## Basecamp

**Entrada desde Basecamp.** Un to-do creado directamente en Basecamp que BackIO importó. La ejecutiva completa lo que
Basecamp no sabe (prioridad, piezas, aprobación) desde la bandeja de entradas.

**Huérfano.** Un to-do de Basecamp sin tarea en BackIO. Se puede adoptar o ignorar; uno ignorado no vuelve a
importarse.

**Reconciliación.** La revisión cada 30 minutos que alinea BackIO con Basecamp por si un webhook se perdió.

**D1.** La única excepción a «el texto de Basecamp no entra»: el título del to-do sí entra, como título interno y nunca
visible al cliente. Ver [decisiones](./decisiones.md).

## Cliente

**Portal.** La vista del proyecto para el cliente, por enlace (`/p/<token>`) y, si se configuró, con PIN.

**Visible al cliente** (`visible_cliente`). Si la tarea aparece en el portal. Viene de la plantilla: se puede ocultar,
nunca abrir.

**Etiqueta para el cliente** (`etiqueta_cliente`). El nombre que ve el cliente en lugar del título interno.

## Técnica

**Tenant.** Una organización dentro de BackIO. Hoy solo existe Geeks, pero todas las tablas llevan `tenant_id`.

**Agente.** Un asistente de IA (Claude, ChatGPT, Gemini) conectado por MCP o por la API.

**Plan** (`plan_id`). La propuesta de cambios que devuelve un agente antes de escribir. Para ejecutarse necesita una
segunda llamada que lo confirme.

**Job.** Una tarea programada que BackIO corre sola (reconciliación, señales, fotos del evolutivo…). Ver
[operación](./operacion.md).
