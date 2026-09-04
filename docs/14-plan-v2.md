# 14 · Plan v2 — BackIO como capa organizativa (septiembre–octubre 2026)

> Estado al 04/09/2026: las fases 0 a 4 del plan original están en producción. Este plan
> consolida los inputs nuevos de Luis (estructura real de Basecamp, mesas, horas, capa de IA)
> en cinco sprints de una semana.

## Principio rector

**Cliente / ejecutiva → BackIO → Basecamp.** BackIO es la única puerta de entrada del trabajo
y la única fuente de estado. Basecamp es el taller: ahí se produce, se comenta y se registran
horas. De Basecamp solo vuelven `completed`, `due_on`, asignados y horas. Nunca texto.

## Inputs consolidados

| # | Input | Implicación en BackIO |
|---|---|---|
| I1 | Proyecto Basecamp = marca (ej. "Banco Amazonas - Fee de Agencia") | `clientes.basecamp_project_id` (ya existe) |
| I2 | Grupo de tareas = todolist (fee mensual "Cronograma de contenido - Septiembre 2026" o campaña puntual) | Proyecto de BackIO = todolist (ya existe) |
| I3 | Grupos dentro de la lista (Regreso a Clases, AON) | Bloques de plantilla → grupos de Basecamp (**nuevo**) |
| I4 | Fee recurrente mes a mes | Plantillas recurrentes con patrón de nombre y generación mensual (**nuevo**) |
| I5 | Muchas plantillas, distintas por cliente | Editor de plantillas + "guardar proyecto como plantilla" + plantillas por cliente (**nuevo**) |
| I6 | Mesas Orión y Omega con boards "Daily (apertura/cierre)" y "Weekly (Status Semanal)" | Publicar actas y daily como mensajes en esos boards, no como Docs (**cambio**) |
| I7 | Timesheet por to-do (1.219 h en BASA) | Sync de horas por requerimiento, sin descripción (**nuevo**) |
| I8 | To-dos existentes creados fuera de BackIO | Importación única + detector de huérfanos (**nuevo**, decisión pendiente) |
| I9 | Daily y weekly se digitan a mano | IA redacta apertura/cierre, status semanal y agenda (**nuevo**) |
| I10 | Informe ejecutivo mensual en el Schedule de la mesa | IA lo redacta desde el dashboard (**nuevo**) |
| I11 | PrometIO → BackIO (Fase 3.5) | Emisor mergeado; falta la prueba de punta a punta |
| I12 | Fase 5: cuentas reales, equipo, baja de Monday | Operativa, arranca cuando I1–I8 estén |

## Sprints

### Sprint 1 · Fidelidad con Basecamp (semana del 7/09)
- Bloques como grupos dentro de la todolist.
- Trabajo de fee: reutilizar la lista del mes del cliente (crearla si no existe); campañas: lista propia.
- `due_on` obligatorio y `completion_subscriber_ids` (ejecutiva + operaciones) en cada to-do.
- Actas y daily publicados como mensajes en los boards de la mesa, con el título que ya usa el equipo (`2026-08-31 || Status Semanal Operativo - Semana 36`). Ids de boards por mesa en Admin → Mesas.
- Prueba de punta a punta PrometIO → BackIO (I11).
- **DoD**: un proyecto creado desde el Builder aparece en Basecamp con la misma forma que los que crea Iván a mano; un acta publicada aparece en el board Weekly de Orión.

### Sprint 2 · Plantillas (semana del 14/09)
- Editor de plantillas en Admin: bloques, tareas, pesos, visibilidad, offsets, rol.
- "Guardar este proyecto como plantilla".
- Plantillas generales y por cliente; en el paso 1 aparecen primero las del cliente.
- Plantillas recurrentes: patrón `{nombre} - {mes} {año}`, fechas desde inicio de mes, botón "Generar mes" y cron el día 25 que deja el borrador para confirmar.
- **DoD**: el fee de Banco Amazonas de octubre se genera desde plantilla y se confirma en el paso 5 en menos de 5 minutos.

### Sprint 3 · Lo que ya existe y las horas — **hecho 04/09/2026**
- Importación única de todolists vivas por cliente (id, título, fecha, asignados, completado) → proyectos y requerimientos enlazados. *Requiere decisión D1.*
- Detector de huérfanos cada 30 min: to-dos creados fuera de BackIO → aviso a operaciones con creador. Métrica de adopción semanal.
- Sync de timesheets: fecha, horas, persona, to-do. Columna "horas" en backlog y dashboard; horas por cliente, mesa y persona.
- Cruce cotizado (PrometIO) vs horas (Basecamp) por cotización.
- **DoD**: el dashboard muestra horas reales del mes por cliente; la lista de huérfanos baja semana a semana.

### Sprint 4 · Capa de IA operativa — **hecho 04/09/2026** (ver `15-ia.md`)
- Apertura y cierre de mesa redactados desde el Daily; Grace edita y publica.
- Status semanal narrado desde el Plan Operativo y las señales; agenda del weekly agrupada por causa con la pregunta de decisión.
- Brief → plan: pegar correo/transcripción y obtener brief estructurado + plantilla sugerida + alcance.
- Recordatorio al cliente por `pendiente_cliente` (borrador, nunca automático).
- Informe ejecutivo mensual por mesa desde el dashboard.
- **DoD**: una semana completa de daily y weekly de Orión publicados desde BackIO con edición mínima de Grace.

### Sprint 5 · Adopción y baja de Monday (desde el 5/10)
- Clientes reales desde PrometIO; `basecamp_project_id` y mesa por cliente; equipo con roles y `basecamp_user_id`.
- Regla de entrada vigente: ningún to-do se crea a mano. Huérfanos → cero.
- Cuatro semanas de coexistencia con Monday; baja al cierre.
- Portal cliente probado en móvil; RLS con usuario real de segundo tenant.

### Después (necesita datos acumulados)
- Estimación de esfuerzo por tipo de tarea con horas históricas.
- Riesgo de atraso al planificar.
- Rentabilidad por servicio y recalibración de pesos de plantilla.

## Decisiones pendientes

| # | Decisión | Quién | Bloquea |
|---|---|---|---|
| D1 | Importar títulos de to-dos existentes como `titulo_interno` (excepción acotada a la regla 1) — **aprobado e implementado 04/09** | Luis | Sprint 3 |
| D2 | Día del cron de generación mensual (propuesto: 25) y quién confirma (ejecutiva de la cuenta) | Marcia | Sprint 2 — **decidido e implementado 04/09: día 25, patrón de la plantilla, Admin → Recurrencias** |
| D3 | Tono y firma de los mensajes IA — por defecto "Redactado por BackIO, publicado por [persona]"; ajustable | Marcia / Grace | Sprint 4 |
| D4 | Formato del informe mensual — implementado (lectura del mes + decisiones + tablas cliente/persona); ajustar con Marcia | Marcia | Sprint 4 |
| D5 | Fecha objetivo de baja de Monday | Luis | Sprint 5 |

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El equipo sigue creando to-dos a mano en Basecamp | Detector de huérfanos con nombre del creador; Marcia lo revisa en el weekly |
| La importación de títulos abre una grieta en la regla 1 | Solo títulos, solo `titulo_interno`, `visible_cliente=false`; comentarios y descripciones siguen fuera |
| La IA escribe cosas que no son verdad | Solo redacta sobre datos estructurados de BackIO; nunca ve Basecamp; una persona publica |
| Plantillas recurrentes generan trabajo fantasma | Nunca se crean solas: borrador + confirmación en paso 5 |
