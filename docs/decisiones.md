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

**Qué.** Basecamp manda sobre «completado». BackIO manda sobre todo lo demás: estado operativo, aprobación, prioridad y
fecha de entrega. Si la fecha de Basecamp queda desfasada, BackIO la vuelve a enviar.

**Por qué.** Basecamp solo conoce «completado sí o no» y BackIO tiene ocho estados operativos: mapearlos en los dos sentidos genera conflictos permanentes.

**Dónde.** `lib/requerimientos/actualizar.ts`, `lib/basecamp/reconcile.ts`.

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
