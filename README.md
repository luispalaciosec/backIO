# BackIO

Sistema de backlog y gestión de cuenta de **Geeks Ecuador** (Moderzacorp S.A.).
Reemplaza Monday.com. Se apoya en Basecamp como capa de ejecución.

---

## Contexto en 60 segundos

Geeks opera hoy con tres sistemas desconectados: Monday (~$15,000/año) para la vista de
cuenta del cliente, Basecamp para ejecución, y documentos manuales para el Plan Operativo
y el Acta de Cierre semanal.

Los tres artefactos del ritual semanal son **la misma data digitada tres veces**. BackIO
unifica la capa de gestión sin tocar la capa de ejecución.

### La suite Geeks

| Sistema | Dominio | Estado |
|---|---|---|
| **PrometIO** | CRM comercial | En uso |
| **DatIO** | Reporting de performance al cliente | En producción, independiente |
| **BackIO** | Operación y backlog | Este repo |
| **Basecamp** | Ejecución de producción | Externo |
| **CoreIO** | Capa compartida | Propuesto, sin decidir |

---

## Las cinco reglas que nunca se rompen

1. **El texto de Basecamp jamás entra a BackIO.** Solo `completed`, `completed_at`,
   `due_on`, `assignee_ids`. Es la garantía estructural de que un comentario interno no
   pueda llegar al cliente.
2. **La visibilidad se hereda de la plantilla, no se decide por tarea.** Solo se puede
   restringir, nunca abrir. Enforced por trigger de base de datos.
3. **Los estados no se sincronizan bidireccionalmente.** Basecamp manda sobre `completed`.
   BackIO manda sobre todo lo demás.
4. **Toda escritura desde un agente requiere preview + confirmación.**
5. **`tenant_id` y RLS en toda tabla**, aunque hoy solo exista un tenant.

---

## Documentos

| # | Archivo | Contenido |
|---|---|---|
| — | `CLAUDE.md` | Convenciones, stack, zonas de revisión humana |
| 00 | `docs/00-arquitectura.md` | Modelo mental, tres capas, alcance de la suite |
| 01 | `docs/01-modelo-datos.md` | Esquema SQL completo, RLS, índices |
| 02 | `docs/02-visibilidad.md` | **Frontera cliente/interno. El documento más importante** |
| 03 | `docs/03-builder.md` | Builder multistep, carga masiva |
| 04 | `docs/04-basecamp.md` | Integración de ejecución |
| 05 | `docs/05-rituales.md` | Weekly, Daily, motor de señales |
| 06 | `docs/06-portal-cliente.md` | Portal público, resumen ejecutivo IA |
| 07 | `docs/07-api-mcp.md` | API REST, MCP para Claude/ChatGPT/Gemini |
| 08 | `docs/08-prometio.md` | Interconexión con el CRM |
| 09 | `docs/09-fases.md` | Plan de ejecución, DoD, riesgos |
| 10 | `docs/10-core.md` | CoreIO, capa compartida (propuesto) |
| 11 | `docs/11-setup.md` | Estructura del repo, variables de entorno, cómo correr |

---

## Estado del código

Monorepo pnpm con backend y frontend separados. Ver `docs/11-setup.md`.

| Paquete | Qué es | Estado |
|---|---|---|
| `shared/` | Tipos + `sanitizeForClient` (única salida al cliente) | Tests pasando |
| `backend/` | API Hono + migraciones Supabase Fase 0 + Basecamp + señales + portal | Tests pasando |
| `frontend/` | Next.js 14: backlog, Builder 5 pasos, import CSV, daily, weekly, portal `/p/:token` | Build pasando |

## Plan: 37 días hábiles (~7-8 semanas)

| Fase | Alcance | Días |
|---|---|---|
| 0 | Esquema, RLS, `cliente_id` unificado con PrometIO | 3 |
| 1 | Builder, tabla, Kanban, notificaciones | 5 |
| 2 | Integración Basecamp | 5 |
| 2.5 | Motor de señales, Plan Operativo, Acta, Daily | 4 |
| 2.7 | API REST + MCP + scopes | 4 |
| 3 | Portal cliente + resumen IA | 5 |
| 3.5 | Webhooks con PrometIO | 2 |
| 4 | Dashboards, weekly con arrastre | 4 |
| 5 | Migración y baja de Monday | 5 |

**Nota de calibración:** PrometIO se construyó en semana y media. BackIO no es comparable —
tiene integración con un sistema de producción vivo, una frontera de visibilidad con
consecuencias comerciales y una capa MCP con scopes. Planificar con 7-8 semanas.

---

## Decisiones tomadas (03/09/2026)

| # | Decisión | Resultado |
|---|---|---|
| 1 | Product owner | **Marcia**, jefe de operaciones. Luis último recurso |
| 2 | ¿CoreIO antes de Fase 0? | **No.** Se revisa cuando BackIO esté en uso |
| 3 | ¿Gantt y Calendario? | **Fase 2** |
| 4 | Canal de notificación | **Correo** |
| 5 | ¿El GG en el backlog operativo? | **No (opción A).** El weekly es de Marcia; Luis no participa |
| 6 | Límite de to-dos por operación en Basecamp | **50** |

---

## Riesgo #1 del proyecto

**Fuga de contenido interno al cliente.** Un comentario de dirección de arte visible en el
portal es la pérdida de una cuenta — y el costo excede varios años del ahorro que justifica
todo el proyecto.

Mitigación: las tres defensas de `docs/02-visibilidad.md` y revisión humana obligatoria
sobre `lib/visibility/`, `lib/basecamp/write.ts`, tools MCP de escritura y políticas RLS.

**Ninguna de esas zonas se commitea automáticamente.**

---

## Nota para Claude Code

Leer en orden: `CLAUDE.md` → `00` → `01`. Ejecutar **solo la Fase 0**. No avanzar a Fase 1
hasta que la verificación de RLS con un tenant de prueba devuelva cero filas y los IDs de
cliente coincidan exactamente con PrometIO.
