# 00 · Arquitectura de BackIO

## El problema que resuelve

Geeks opera hoy con tres sistemas desconectados:

| Sistema | Función real | Problema |
|---|---|---|
| Monday.com | Vista de cuenta para cliente | ~$15,000/año, muere por falta de disciplina |
| Basecamp | Ejecución de producción | Sin visibilidad agregada, sin backlog priorizado |
| Docs manuales | Plan Operativo y Acta de Cierre | Doble digitación semanal de la misma data |

BackIO unifica la capa de gestión sin tocar la capa de ejecución.

## Las tres capas

```
┌─────────────────────────────────────────────────────────┐
│  CAPA CLIENTE (portal público, token firmado)           │
│  Avance ponderado · Hitos visibles · Resumen ejecutivo  │
│  NO tiene acceso a base interna. Consume payload         │
│  sanitizado vía endpoint dedicado.                       │
└──────────────────────▲──────────────────────────────────┘
                       │ payload sanitizado
┌──────────────────────┴──────────────────────────────────┐
│  CAPA GESTIÓN — BackIO (Supabase + Next.js)             │
│  Requerimientos · Plantillas · Pesos · Visibilidad      │
│  Motor de señales · Plan Operativo · Acta de Cierre     │
│  API REST + MCP Server                                   │
└──────────────────────▲──────────────────────────────────┘
                       │ SOLO: completed, completed_at,
                       │ due_on, assignee_ids
                       │ (NUNCA texto)
┌──────────────────────┴──────────────────────────────────┐
│  CAPA EJECUCIÓN — Basecamp                              │
│  To-dos · Comentarios de arte · Versiones · Adjuntos    │
│  Discusión interna sin filtro                            │
└─────────────────────────────────────────────────────────┘
```

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
2. BackIO propone crear proyecto (plantilla + alcance prellenado)
        ↓ ejecutiva confirma en Builder (5 pasos)
3. BackIO crea requerimientos + to-dos en Basecamp
        ↓ equipo trabaja en Basecamp
4. Webhook Basecamp → BackIO actualiza completed + ultima_actualizacion
        ↓ cálculo automático
5. Avance ponderado → Portal cliente + Dashboards internos
        ↓ lunes 6am
6. Motor de señales → Agenda del Weekly
        ↓ viernes
7. Acta de Cierre generada automáticamente
```

## Entidades principales

| Entidad | Descripción |
|---|---|
| `cliente` | Cuenta. `cliente_id` COMPARTIDO con PrometIO |
| `plantilla` | Estructura reutilizable de proyecto (Campaña 360, Lanzamiento, etc.) |
| `plantilla_tarea` | Tarea tipo dentro de una plantilla, con peso y visibilidad |
| `proyecto` | Instancia de una plantilla para un cliente |
| `requerimiento` | Unidad de trabajo. Apunta a un to-do de Basecamp |
| `semana` | Agrupador ISO. Base del weekly |
| `señal` | Condición disparada que entra a la agenda del weekly |
| `acta` | Documento generado (Plan Operativo o Cierre) |

## Alcance dentro de la suite Geeks

La suite de Geeks tiene cuatro piezas. BackIO se integra con una sola.

| Sistema | Dominio | ¿Se integra con BackIO? |
|---|---|---|
| **PrometIO** | CRM comercial | **Sí.** `cliente_id` compartido + webhooks. Ver `08-prometio.md` |
| **Basecamp** | Ejecución de producción | **Sí.** Ver `04-basecamp.md` |
| **DatIO** | Reporting de performance al cliente | **No, por ahora** |

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

Resueltas el 03/09/2026. Ver tabla en `09-fases.md`: product owner Marcia, sin CoreIO por
ahora, Gantt/Calendario en Fase 2, GG fuera del backlog operativo (opción A), notificaciones
por correo, límite de 50 to-dos por operación.
