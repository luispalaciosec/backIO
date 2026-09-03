# BackIO — Sistema Operativo de Backlog · Geeks Ecuador

## Qué es esto

BackIO es la capa de gestión de cuenta y backlog operativo de Geeks. Reemplaza Monday.com
como interfaz de cara al cliente y como tablero de requerimientos, apoyándose en Basecamp
como sistema de ejecución.

## La suite Geeks

| Sistema | Dominio | Relación con BackIO |
|---|---|---|
| **PrometIO** | CRM comercial | Integrado. `cliente_id` compartido |
| **BackIO** | Operación y backlog | Este repo |
| **DatIO** | Reporting de performance al cliente | Independiente. Ver `00-arquitectura.md` |
| **Basecamp** | Ejecución de producción | Integrado. Fuente de `completed` |
| **CoreIO** | Identidad, clientes, roles, servicios, UI | Ver `10-core.md` |

## Stack

| Capa | Tecnología |
|---|---|
| Base de datos + Auth | Supabase (Postgres + RLS) |
| Frontend | Next.js 14 (App Router) en Vercel |
| Estilos | Tailwind CSS |
| Integración ejecución | Basecamp 3 API (OAuth2 + webhooks) |
| Capa agentes | MCP Server + API REST |
| LLM | Claude (Anthropic API) para resúmenes ejecutivos |

## Las cinco reglas que NUNCA se rompen

### 1. El texto de Basecamp jamás entra a BackIO
BackIO sincroniza desde Basecamp únicamente: `completed (bool)`, `completed_at`, `due_on`,
`assignee_ids`. **Nunca** el cuerpo de comentarios, nunca descripciones, nunca adjuntos de
discusión. El canal de producción vive y muere en Basecamp.

Razón: es la única garantía estructural de que un comentario interno ("esto está horrible")
no pueda llegar al cliente. Si el texto nunca entra, no hay bug posible que lo saque.

### 2. La visibilidad se hereda, no se decide
`visible_cliente` viene de la plantilla. Un usuario puede **restringir** (visible → oculto),
nunca **abrir** (oculto → visible). Enforced a nivel de trigger de base de datos, no de UI.

### 3. Los estados no se sincronizan bidireccionalmente
Basecamp manda sobre `completed`. BackIO manda sobre todo lo demás (estado operativo,
estado de aprobación, prioridad, peso). No hay merge de estados. No se negocia.

### 4. Toda escritura desde un agente requiere preview + confirmación
Las tools MCP de escritura devuelven un plan de cambios. No ejecutan. La ejecución es una
segunda llamada con el `plan_id` confirmado.

### 5. `tenant_id` en toda tabla, RLS en toda tabla
Aunque hoy solo exista un tenant (Geeks). No es sobre-ingeniería: es lo que hace que BackIO
sea portable mañana sin reescribir.

## Convenciones de código

- TypeScript estricto. `any` está prohibido salvo en boundaries de API externa.
- Nombres de tablas y columnas en `snake_case` español (`fecha_entrega`, `owner_agencia`).
- Nombres de código en inglés (`getWeeklySignals`, `RequirementCard`).
- Toda query a Supabase pasa por `lib/db/` — sin llamadas directas desde componentes.
- Fechas en UTC en la base, se renderizan en `America/Guayaquil`.
- Sin `localStorage` para datos de negocio. Todo en Supabase.

## Zonas de revisión humana obligatoria

Claude Code puede operar en modo autónomo en todo el proyecto EXCEPTO:

| Zona | Por qué |
|---|---|
| `lib/visibility/` y sus tests | Un error quema una cuenta |
| `lib/basecamp/write.ts` | Escribe en producción real de la agencia |
| `lib/mcp/tools/*write*` | Un agente puede crear 40 tareas por malinterpretar |
| Políticas RLS | Un error expone datos entre tenants |

En estas zonas: generar, detener, pedir revisión. No hacer commit automático.

## Orden de lectura de las specs

1. `docs/00-arquitectura.md` — el modelo mental completo
2. `docs/01-modelo-datos.md` — esquema y RLS
3. `docs/02-visibilidad.md` — la frontera cliente/interno
4. `docs/03-builder.md` — creación de proyectos
5. `docs/04-basecamp.md` — integración de ejecución
6. `docs/05-rituales.md` — weekly, daily, motor de señales
7. `docs/06-portal-cliente.md` — lo que ve el cliente
8. `docs/07-api-mcp.md` — API REST y conectores de agentes
9. `docs/08-prometio.md` — interconexión con el CRM
10. `docs/09-fases.md` — plan de ejecución
11. `docs/10-core.md` — CoreIO, capa compartida de la suite

## Definition of Done por fase

Ninguna fase se cierra sin:
- Tests de la frontera de visibilidad pasando (ver `02-visibilidad.md`)
- Migración de Supabase versionada y aplicada
- RLS verificada con usuario de prueba de otro tenant
