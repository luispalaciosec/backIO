# 00 · Arquitectura de BackIO

> Revisado contra el código el 11/10/2026.

## El problema que resuelve

Geeks opera hoy con tres sistemas desconectados:

| Sistema | Función real | Problema |
|---|---|---|
| Monday.com | Vista de cuenta para cliente | costo anual en licencias; muere por falta de disciplina |
| Basecamp | Ejecución de producción | Sin visibilidad agregada, sin backlog priorizado |
| Docs manuales | Plan Operativo y Acta de Cierre | Doble digitación semanal de la misma data |

BackIO unifica la capa de gestión sin tocar la capa de ejecución.

## Las tres capas

```
┌─────────────────────────────────────────────────────────┐
│  CAPA CLIENTE (portal público, enlace con token         │
│  aleatorio)                                             │
│  Avance ponderado · Hitos visibles · Resumen ejecutivo  │
│  NO tiene acceso a base interna. Consume payload        │
│  sanitizado vía endpoint dedicado.                      │
└──────────────────────▲──────────────────────────────────┘
                       │ payload sanitizado
┌──────────────────────┴──────────────────────────────────┐
│  CAPA GESTIÓN — BackIO                                  │
│  Frontend Next.js · Backend Hono (Node) · Supabase      │
│  Requerimientos · Plantillas · Pesos · Visibilidad      │
│  Motor de señales · Plan Operativo · Acta de Cierre     │
│  API REST + MCP Server                                  │
└──────────────────────▲──────────────────────────────────┘
                       │ completed, completed_at, due_on,
                       │ assignee_ids, título del to-do (D1),
                       │ listas y grupos, horas del timesheet
                       │ (NUNCA comentarios, descripciones
                       │ ni adjuntos)
┌──────────────────────┴──────────────────────────────────┐
│  CAPA EJECUCIÓN — Basecamp                              │
│  To-dos · Comentarios de arte · Versiones · Adjuntos    │
│  Discusión interna sin filtro                           │
└─────────────────────────────────────────────────────────┘
```

El token del portal son 32 bytes aleatorios en base64url (`backend/src/lib/portal/token.ts`). No está
firmado: funciona como una contraseña larga que se puede rotar. Ver [06 · Portal cliente](./06-portal-cliente.md).

La capa de gestión tiene tres piezas de código. El frontend es Next.js 15.5 con React 19 y vive en Vercel.
El backend es una aplicación Hono sobre Node (`backend/src/app.ts`) y concentra la API REST (`/api/v1`), el
portal (`/api/portal`), los webhooks, el servidor MCP (`/mcp`) y el OAuth para agentes (`/oauth`). Supabase
guarda los datos y aplica RLS.

Lo que entra desde Basecamp, con detalle:

- Estado del to-do: `completed`, `completed_at`, `due_on` y los ids de los responsables.
- El título del to-do, que se guarda como `titulo_interno` y nunca es visible al cliente. Es la excepción D1
  (ver [02 · Visibilidad](./02-visibilidad.md)).
- La estructura: cada lista de to-dos se vuelve un proyecto y cada grupo, un bloque. El nombre de la lista es el
  nombre del proyecto y el cliente lo ve en el portal (excepción D1b)
  (`backend/src/lib/basecamp/importar.ts`).
- Las horas del timesheet por tarea y persona, sin la descripción de cada entrada
  (`BasecampClient.timesheetSafe` en `backend/src/lib/basecamp/client.ts`).

Comentarios, descripciones y adjuntos no entran nunca.

## Por qué la separación es física y no lógica

La alternativa obvia es tener todo en una base y controlar visibilidad con un booleano.
Se rechaza por una razón: **un booleano se puede marcar mal.**

Bajo presión, a las 11pm, cerrando una campaña, alguien va a escribir un comentario interno
en el campo equivocado. No es hipotético — es estadística. Con volumen suficiente ocurre.

Con separación física, el error es imposible: el texto interno nunca sale de Basecamp, así
que ningún bug, ningún endpoint mal escrito, ningún agente LLM mal configurado puede
exponerlo.

El costo de esta decisión: para leer comentarios de arte hay que entrar a Basecamp. Se acepta.

## Flujo principal end-to-end

```
1. Cotización ganada en PrometIO
        ↓ webhook
2. BackIO deja un borrador de proyecto (plantilla + alcance prellenado)
        ↓ ejecutiva confirma en Builder (5 pasos)
3. BackIO crea requerimientos + to-dos en Basecamp
   (o el equipo crea la lista en Basecamp y BackIO la importa)
        ↓ equipo trabaja en Basecamp
4. Webhook Basecamp → BackIO actualiza estado, cancela o restaura,
   e importa to-dos nuevos
        ↓ cálculo automático
5. Avance ponderado → Portal cliente + Dashboards internos
        ↓ domingo 18:00
6. Motor de señales → Agenda del Weekly
        ↓ cuando la mesa lo pide
7. Acta de Cierre generada y publicada a mano desde BackIO
```

Detalles de cada paso:

- **Paso 4.** El webhook hace más que marcar completado. Si un to-do va a la papelera o se archiva, el
  requerimiento queda cancelado; si se restaura, vuelve a En proceso (`backend/src/lib/basecamp/sync.ts`). Si
  llega un to-do que BackIO no conoce, programa la importación de ese cliente
  (`backend/src/routes/webhooks/basecamp.ts`). Ver [04 · Basecamp](./04-basecamp.md).
- **Paso 6.** El job `senales` corre los domingos a las 18:00 (hora de Guayaquil) y manda la agenda del weekly
  a operaciones y admin.
- **Paso 7.** No hay un job que genere el acta los viernes. Se genera con `POST /semanas/:id/acta` y se
  publica en Basecamp con `POST /semanas/actas/:actaId/publicar` (`backend/src/routes/v1/semanas.ts`).

### Mesas

Los rituales se organizan por mesa. Una mesa es un equipo de cuenta que maneja varios clientes; cada cliente
pertenece a una mesa y un proyecto puede asignarse a otra. Daily, weekly, actas e informe mensual se arman y se
publican por mesa, en los boards de Basecamp de esa mesa. Ver [05 · Rituales](./05-rituales.md).

### Basecamp como origen aceptado

Desde el 23/09/2026 un proyecto también puede nacer en Basecamp. Lo que el equipo crea allá (listas, grupos,
to-dos) entra solo a BackIO, oculto al cliente, y la ejecutiva lo completa después. El Builder sigue siendo el
camino preferido. Ver [04 · Basecamp](./04-basecamp.md).

### Tareas programadas

El backend tiene su propio programador de tareas (`backend/src/lib/jobs.ts`, tabla `JOBS`). Se activa con
`ENABLE_INTERNAL_CRON=1`, que el `Dockerfile` del backend ya define. Cada corrida queda registrada en la tabla
`cron_runs`, así un job no se pierde por un reinicio ni corre dos veces en la misma ventana.

| Job | Cuándo |
|---|---|
| `notificaciones` | Cada minuto (reintento de correos) |
| `estructura` | Cada 15 min (importación desde Basecamp) |
| `reconcile` | Cada 30 min (reconciliación con Basecamp) |
| `vigia` | Cada hora |
| `horas` | Cada 6 h (timesheet de Basecamp) |
| `limpieza` | Diario 03:30 |
| `recurrencias` | Diario 08:05 |
| `informe_mensual` | Día 1, 08:00 |
| `kpis_congelar` | Día 1, 08:10 |
| `salud_clientes` | Lunes a viernes 07:30 (salud de los clientes y aviso si cambia) |
| `riesgo_semana` | Lunes 07:35 (tareas en riesgo de la semana y aviso a líderes y ejecutivas) |
| `mi_dia` | Lunes a viernes 07:45 (correo «Mi día», desde el 2/11/2026) |
| `foto_daily` | Lunes a viernes 19:30 |
| `foto_semana` | Domingo 17:55 |
| `senales` | Domingo 18:00 |

El vigía (`backend/src/lib/vigia.ts`) revisa que los demás jobs hayan corrido. Si uno de hora fija se saltó su
ventana, o uno de intervalo lleva tres intervalos sin correr, deja el error en el log y en Sentry y avisa por
correo a las personas admin. El estado de cada tarea se ve en Admin → Servicios.

## Entidades principales

Los nombres de tabla están en plural.

| Tabla | Descripción |
|---|---|
| `clientes` | Cuenta. `cliente_id` COMPARTIDO con PrometIO |
| `mesas` | Equipo de cuenta. Agrupa clientes y organiza los rituales |
| `plantillas` | Estructura reutilizable de proyecto (Campaña 360, Lanzamiento, etc.) |
| `plantilla_tareas` | Tarea tipo dentro de una plantilla, con peso y visibilidad |
| `proyectos` | Instancia de una plantilla para un cliente, o lista importada de Basecamp |
| `requerimientos` | Unidad de trabajo. Apunta a un to-do de Basecamp |
| `semanas` | Agrupador ISO. Base del weekly |
| `senales` | Condición disparada que entra a la agenda del weekly |
| `actas` | Documento generado. `tipo`: `plan_operativo`, `cierre` o `informe_mensual` |

## Alcance dentro de la suite Geeks

Además de BackIO, la suite de Geeks incluye estos sistemas:

| Sistema | Dominio | ¿Se integra con BackIO? |
|---|---|---|
| **PrometIO** | CRM comercial | **Sí.** `cliente_id` compartido + webhooks. Ver [08 · PrometIO](./08-prometio.md) |
| **Basecamp** | Ejecución de producción | **Sí.** Ver [04 · Basecamp](./04-basecamp.md) |
| **DatIO** | Reporting de performance al cliente | **No, por ahora** |

CoreIO, la capa compartida de identidad y clientes descrita en [10 · CoreIO](./10-core.md), no se construye por
ahora (decisión del 03/09/2026). BackIO usa tablas propias y comparte con PrometIO solo el `cliente_id`.

### Por qué DatIO queda fuera del alcance

DatIO reemplaza Supermetrics y Looker Studio como plataforma de reporting de redes hacia
el cliente. Es una superficie de cliente, igual que el portal de BackIO, pero responde una
pregunta distinta:

| | BackIO portal | DatIO |
|---|---|---|
| Responde | ¿Cómo va lo que pedí? | ¿Cómo funcionó lo que salió? |
| Fuente | Basecamp | APIs de Meta, IG, LinkedIn, YouTube, TikTok |

La integración con valor real sería **atribución pieza → performance**: saber que el reel
entregado el 04/08 generó X alcance. Pero requiere que cada pieza producida lleve un
identificador único que sobreviva hasta la publicación.

**Hoy las piezas se nombran libremente.** Sin ese identificador, la atribución es imposible
y lo único conectable sería un portal común, que es cosmético.

**Decisión: DatIO y BackIO permanecen independientes.**

Precondición para reabrir esta decisión: que exista una convención de identificador de pieza
adoptada por producción y que DatIO pueda leerla desde la data de las plataformas. Antes de
eso, la conversación no tiene sustancia.

---

## Decisiones tomadas y cerradas

| Decisión | Elección | Estado |
|---|---|---|
| `cliente_id` unificado con PrometIO | Sí | **Cerrada** |
| Sincronización bidireccional de estados | No | **Cerrada** |
| Texto de Basecamp en BackIO | Nunca | **Cerrada** |
| Visibilidad heredada de plantilla | Sí | **Cerrada** |
| Avance ponderado (no conteo simple) | Sí | **Cerrada** |
| `tenant_id` desde día uno | Sí | **Cerrada** |
| Venta como SaaS en 2026 | No | **Cerrada** |
| Integración con DatIO | No, por ahora | **Cerrada** (ver precondición arriba) |

## Decisiones pendientes (bloquean fases específicas)

Resueltas el 03/09/2026. Ver tabla en [09 · Fases](./09-fases.md): product owner Marcia, sin CoreIO por
ahora, Gantt/Calendario en Fase 2, GG fuera del backlog operativo (opción A), notificaciones
por correo, límite de 50 to-dos por operación.
