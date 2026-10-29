# Registro de decisiones

Por qué BackIO funciona como funciona. Cada decisión dice qué se decidió, por qué, cuándo y quién la tomó. Antes de
cambiar una de estas reglas, conviene leer su porqué: casi todas nacieron de un problema real.

Para agregar una decisión: copia el formato de las de abajo, con la fecha y la persona, y enlaza la página que la
explica en detalle. Un «—» en la columna «Por qué» significa que el motivo no quedó escrito: si lo sabes, complétalo.

## Las cinco reglas que no se rompen

Vienen del diseño original (`CLAUDE.md`) y se sostienen en el código, no en la buena voluntad.

### R1 · El texto de Basecamp no entra a BackIO

**Qué.** De Basecamp solo se sincronizan el estado de completado, la fecha de cierre, la fecha de entrega y los
asignados. Nunca comentarios, descripciones ni adjuntos.

**Por qué.** Es la única garantía estructural de que un comentario interno («esto está horrible») no llegue al cliente:
si el texto nunca entra, no hay error posible que lo saque. La excepción acotada es [D1](#d1).

**Dónde.** `lib/basecamp/sync.ts` (`extractSafeTodo`), [Integración con Basecamp](./04-basecamp.md).

### R2 · La visibilidad se hereda, no se decide

**Qué.** Si una tarea es visible para el cliente lo dice la plantilla. Una persona puede ocultarla, nunca abrirla.

**Por qué.** Es la segunda defensa de la frontera con el cliente: aunque algo falle en la pantalla, nada se abre por accidente. Para hacer visible algo que no lo era se edita la plantilla.

**Dónde.** Un trigger de la base lo impide aunque la pantalla falle. [Qué ve el cliente](./02-visibilidad.md).

### R3 · Los estados no se sincronizan en los dos sentidos

**Qué.** Basecamp manda sobre «completado». BackIO manda sobre todo lo demás: estado operativo, aprobación y prioridad.
La fecha de entrega la decide el cambio más reciente: si alguien la cambia en Basecamp después que en BackIO, BackIO la
acepta como reprogramación desde Basecamp (sin motivo, queda en Causas pendientes); si BackIO la cambió después, la
vuelve a enviar (decisión de Luis, 19/10/2026; antes BackIO siempre reenviaba la suya).

**Por qué.** Basecamp solo conoce «completado sí o no» y BackIO tiene ocho estados operativos: mapearlos en los dos sentidos genera conflictos permanentes.

**Dónde.** `lib/requerimientos/actualizar.ts`, `lib/basecamp/sync.ts` (`aceptarFechaDeBasecamp`), `lib/basecamp/reconcile.ts`.

### R4 · Un agente propone y una persona confirma

**Qué.** Las tools de escritura del MCP devuelven un plan de cambios y no ejecutan nada. La ejecución es una segunda
llamada con el `plan_id`, que vence en 15 minutos, es de un solo uso y solo la puede confirmar la misma credencial.

**Por qué.** Un agente que malinterpreta una instrucción podría crear 40 tareas de golpe.

**Dónde.** `lib/mcp/tools/write_*.ts`, [API y agentes](./07-api-mcp.md).

### R5 · `tenant_id` y RLS en todas las tablas

**Qué.** Toda tabla tiene `tenant_id` y políticas de seguridad por fila, aunque hoy exista un solo tenant (Geeks).

**Por qué.** Es lo que permite llevar BackIO a otra organización sin reescribirlo, y lo que impide que un error
mezcle datos entre organizaciones.

**Dónde.** [Modelo de datos](./01-modelo-datos.md).

## Decisiones de producto

| Id | Decisión | Por qué | Fecha · quién |
|---|---|---|---|
| <span id="d1">D1</span> | El **título** de los to-dos de Basecamp entra como título interno, nunca visible al cliente | Sin títulos no se podían importar las listas existentes; el título es un dato operativo, no una conversación | 04/09/2026 · Luis |
| <span id="d1b">D1b</span> | El **nombre de la lista** de Basecamp entra como nombre del proyecto y el cliente lo ve en el portal; el equipo nombra las listas como las vería el cliente | El portal necesita un nombre de proyecto y ese es el que le pone el equipo; no es una conversación | 13/10/2026 · Luis |
| D2 | Los fees generan el proyecto del mes siguiente **el día configurado** de cada recurrencia (25 por defecto, de 1 a 28), con el patrón de la plantilla. Se configura en Admin → Recurrencias; el proyecto se crea completo y baja a Basecamp sin pasar por un borrador | — | 04/09/2026 · Marcia |
| D3 | Los textos de la IA se firman «Redactado por BackIO, publicado por [persona]» | La IA redacta y una persona publica: queda claro quién responde | Por defecto; ajustable · Marcia / Grace |
| D4 | El informe mensual trae la lectura del mes, las decisiones y tablas por cliente y por persona | Formato inicial; se ajusta con Marcia | 09/2026 · Marcia |
| D5 | Fecha objetivo para dejar Monday | Pendiente | — · Luis |
| — | Product owner: **Marcia** (jefa de operaciones); Luis, último recurso | — | 03/09/2026 · Luis |
| — | **CoreIO no se construye** por ahora: tablas propias más el `cliente_id` compartido con PrometIO y su webhook | — | 03/09/2026 · Luis. Ver la propuesta en [CoreIO](./10-core.md) |
| — | La gerencia general **no aparece** en el backlog operativo | El weekly es de Marcia; sin excepciones en el motor de señales, simplemente no se le asignan tareas | 03/09/2026 · Luis |
| — | Notificaciones **por correo** | — | 03/09/2026 · Luis |
| — | Máximo **50 to-dos** por operación en Basecamp; sobre eso, confirmación explícita adicional | Acota el daño de una creación masiva por error ([Basecamp](./04-basecamp.md)) | 03/09/2026 · Luis |
| — | Cambiar la fecha de entrega desde la pantalla **exige motivo** (API y agentes pueden omitirlo y queda «sin causa» como señal) | Sin motivo no se puede saber a quién atribuir el atraso | 04/09/2026 |
| — | En el portal, una tarea cancelada se muestra como «En proceso» | — | 04/09/2026 · Luis |
| — | En el portal, las tareas canceladas **no cuentan en el avance** del proyecto (siguen en la lista como «En proceso») | — | 11/10/2026 · Luis |
| — | **Ninguna tarea entra al daily sin responsable** | En el daily nadie sabría a quién preguntar | 22/09/2026 |
| — | **Basecamp es un origen aceptado**: lo que el equipo crea allí entra solo a BackIO | Tras una semana de uso real, producción seguía creando to-dos en Basecamp y las ejecutivas gastaban su tiempo adoptando huérfanos ([Basecamp](./04-basecamp.md#basecamp-como-origen-aceptado-23-09-2026)) | 23/09/2026 · Luis |
| — | Cuando alguien se va, una tarea reasignada **cuenta para quien la cierra**; si la recibió con menos de 3 días hábiles para la entrega (o vencida) queda «heredada» y su atraso no cuenta para nadie | — | 11/10/2026 · Luis. Ver [Cuando alguien se va](./20-salida.md) |
| — | Las tareas de quien se va se reparten **por cliente, con vista previa**: por defecto al líder de la mesa, con cambio por grupo o por tarea | — | 11/10/2026 · Luis |
| — | En una salida, BackIO **cambia también al responsable en Basecamp**, de a 50 to-dos | — | 11/10/2026 · Luis |
| — | Lo que alguien hace desde BackIO se escribe en Basecamp **con su propia cuenta**; si no la conectó, BackIO no escribe por ella. Lo automático con responsable (fee recurrente, fecha reenviada) va con la cuenta de esa persona; sin usuario «BackIO» aparte. Todos usan BackIO y Basecamp por igual | Basecamp mostraba todo como hecho por quien conectó la integración y se perdía la trazabilidad de quién hizo qué | 16/10/2026 · Luis. Ver [Basecamp](./04-basecamp.md#autenticacion) |
| — | En Basecamp no sale nada a nombre de quien no lo hizo. La fecha cambiada en Basecamp después que en BackIO se acepta como reprogramación desde Basecamp; lo automático cuyo responsable no conectó su Basecamp no se escribe y se avisa; la cuenta de la organización solo lee; una API key escribe a nombre de quien la creó | Grace cambió una fecha en Basecamp, la reconciliación la revirtió y Basecamp mostró a Luis como autor | 19/10/2026 · Luis. Ver [Basecamp](./04-basecamp.md#autenticacion) |
| — | El plan y el acta de cada mesa llevan un marcador: meta del 80 % igual para todas las mesas, racha, récord del trimestre y reconocimiento a quien entregó todo a tiempo con al menos 4 tareas. Sobrio: sin emojis ni lenguaje de juego, y nunca se nombra a quien no cumplió | Que el weekly sea más motivador sin quitarle seriedad | 20/10/2026 · Luis. Ver [Rituales](./05-rituales.md#marcador-20-10-2026) |
| — | En el marcador, cada tarea cuenta en la semana de su fecha original; solo una reprogramación atribuible al cliente la pasa a otra semana. Una reprogramación sin motivo cuenta como del equipo | Reprogramar una tarea atrasada la sacaba de su semana y mejoraba el resultado | 21/10/2026 · Luis |
| — | Cada acuerdo del weekly pertenece a la mesa en cuyo weekly se acordó | Adivinar la mesa por las tareas del responsable duplicaba acuerdos entre mesas y perdía los de quien no tiene tareas en la mesa | 21/10/2026 · Luis |
| — | BackIO guarda la última fecha que vio en Basecamp y solo acepta una fecha de Basecamp distinta de esa | Comparar horas del to-do fallaba: un comentario en Basecamp revirtió un cambio hecho en BackIO | 21/10/2026 · Luis |
| — | Botón «Atendida» en las señales del weekly, con quién y cuándo, y señales agrupadas por cliente | Ninguna de las 457 señales se había podido marcar como atendida y eran demasiadas para revisarlas sueltas | 21/10/2026 · Luis |
| — | Cervecería Nacional C.N. (mesa Orión) es la empresa dueña de los 7 fees «AB-Inbev ||…»: sus cotizaciones se convierten en proyecto de uno de esos fees. Notion es una compañía de prueba. Los duplicados de PrometIO se unifican allá y en BackIO se desactiva el que sobra | Las cotizaciones de C.N. llegaban a un cliente sin mesa ni Basecamp, donde nadie las veía | 28/10/2026 · Luis |
| — | Cancelar una tarea en BackIO archiva su to-do en Basecamp, a nombre de quien la cancela; reabrirla lo vuelve a activar | «Briefing Pasaportes» se canceló en BackIO y siguió abierto en Basecamp | 28/10/2026 · Luis |
| — | Cambiar responsables en BackIO actualiza los asignados del to-do en Basecamp, a nombre de quien reasigna; los externos asignados (como Audela) se conservan. Juan Chancay (comercial) y Samuel Viez (Audela) no tienen usuario en BackIO; lo de Carlos Parra (ex director creativo) pasa a Julio Lucio | Reasignar en BackIO no llegaba a Basecamp y la sincronización lo deshacía | 28/10/2026 · Luis |
| — | **Acme EC S.A.S es cliente de prueba**: no cuenta en señales, actas, dashboard, personas ni KPIs | Es el cliente del sandbox de Basecamp; sus tareas de prueba ensuciaban el weekly de las mesas | 19/10/2026 · Luis |
| — | **Mesa y ejecutiva de cuenta son cosas distintas**: la mesa es el equipo que produce (daily y weekly); la ejecutiva de cuenta se asigna por cliente y puede tener cuentas en varias mesas. Un cliente se queda en la mesa que lo produce | Grace lleva Grupo Torres & Torres, que produce Omega, sin pertenecer a esa mesa ([Clientes](./21-clientes.md)) | 29/10/2026 · Luis |
| — | **Ficha de cliente** con la ejecutiva, proyectos, atrasos, salud por entregas y reprocesos, y sugerencias de la IA. La salud del dashboard y la de la ficha son la misma regla | — | 29/10/2026 · Luis |
| — | Los títulos del daily llevan **emojis fijos** (🎯 ⛔ ✅…), y los pone el código, no la IA | Son el formato del equipo en Basecamp y sirven para encontrar cada sección de un vistazo | 11/10/2026 · Luis |

## Decisiones técnicas

| Decisión | Por qué | Fecha |
|---|---|---|
| «A tiempo» se calcula con el **día en hora de Guayaquil** y con una sola función para todo el sistema | Cumplimiento y KPIs daban números distintos para la misma tarea | 10/10/2026 (auditoría, B4) |
| Las tareas programadas se registran en `cron_runs` y un **vigía** avisa si una no corre | Un despliegue a la hora de un job lo perdía sin que nadie se enterara | 10–11/10/2026 |
| Las operaciones de varios pasos (import CSV, Builder, quitar acceso) van en **una transacción** de Postgres | Un fallo a medias dejaba proyectos huérfanos o credenciales vivas | 11/10/2026 (migración 29) |
| Errores a **Sentry sin datos personales** ni del cliente | Ver los errores sin exponer información | 11/10/2026 |
| La documentación es **escrita a mano**, sin wikis generados por IA, y se publica en `backio.vercel.app/docs` (pública, fuera de buscadores), después de cerrar los pendientes de seguridad | La documentación es la fuente de verdad: tiene que ser exacta. Publicarla junto a la app evita montar otra plataforma | 11/10/2026 · Luis |

El detalle de las decisiones de seguridad está en [Seguridad](./18-seguridad.md) y en
[Endurecimiento tras la auditoría](./endurecimiento.md).
