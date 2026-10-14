# 07 · API REST y capa de agentes (MCP)

> Revisado contra el código el 11/10/2026.

## Decisión de arquitectura

No se construyen tres integraciones (Claude, Gemini, ChatGPT). Se construye **una capa MCP**
y un adaptador OpenAPI.

```
Claude / Claude Cowork ──┐
ChatGPT (conectores)   ──┼──▶ MCP Server (/mcp) ──┐
Agentes futuros        ──┘                        ├──▶ Supabase
Gemini (vía OpenAPI)   ──────▶ API REST (/api/v1) ─┤
PrometIO (CRM)         ──────▶ webhook + REST ─────┘
```

PrometIO no usa el MCP. Envía un webhook y consulta `GET /clientes/:id/resumen` por REST
(ver [08-prometio.md](./08-prometio.md)).

Las tools se escriben una vez. Un modelo nuevo mañana no requiere trabajo adicional.

**Este es el activo diferenciado de BackIO.** No es el código de la tabla; es el conjunto
de tools + plantillas + motor de señales, que encapsula cómo opera una agencia. Ese
conocimiento es de 16 años, no de un sprint.

---

## API REST

Base: `https://backiobackend-production.up.railway.app/api/v1` (el backend corre en Railway).
Auth: `Authorization: Bearer {api_key}`

La spec OpenAPI toma la dirección del servidor de la variable `BACKEND_PUBLIC_URL`. La lista completa de
rutas, con sus parámetros, está en la [referencia de la API](./referencia-api.md). Esta tabla resume las
principales.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/clientes` | Lista de clientes |
| GET | `/proyectos` | Filtros: `cliente` y `estado` |
| GET | `/proyectos/:id` | Detalle con requerimientos |
| POST | `/proyectos` | Crear desde plantilla |
| GET | `/requerimientos` | Backlog filtrado |
| POST | `/requerimientos` | Crear requerimiento |
| PATCH | `/requerimientos/:id` | Actualizar |
| POST | `/requerimientos/bulk` | Carga masiva |
| GET | `/semanas/:id/senales` | Señales de la semana |
| GET | `/semanas/:id/capacidad` | Carga por persona |
| POST | `/semanas/:id/plan` | Generar Plan Operativo (acepta `?mesa=`) |
| POST | `/semanas/:id/acta` | Generar Acta de Cierre (acepta `?mesa=`) |
| GET | `/plantillas` | Plantillas disponibles |

---

## Scopes de API key

```typescript
type Scope =
  | 'read:backlog'      | 'read:proyectos'    | 'read:senales'
  | 'read:capacidad'    | 'write:requerimientos'
  | 'write:proyectos'   | 'write:actas'
  | 'admin';
```

| Perfil | Scopes | Uso |
|---|---|---|
| Lectura gerencial | `read:*` | Dashboards, consultas de Luis por Claude |
| Ejecutiva | `read:*`, `write:requerimientos` | Trabajo diario asistido |
| Operaciones | `read:*`, `write:*` | Marcia, generación de actas |
| PrometIO | `read:proyectos`, `write:proyectos` | Webhook de cotización ganada |
| Cliente | `read:proyectos` | Agente de un cliente; exige indicar el `cliente_id` al crear la key |
| Custom | Los que se elijan | Integraciones con permisos a medida |

Los perfiles están en `backend/src/routes/v1/admin.ts` (`PERFILES`). Las API keys se almacenan hasheadas y
se muestran una sola vez al crearlas.

Una key de perfil cliente solo funciona por el MCP. En la API REST recibe 403
(`backend/src/lib/auth/middleware.ts`), porque las rutas REST devuelven datos internos.

### Tokens OAuth

Los clientes MCP que se conectan con OAuth 2.1 reciben un token de acceso `bko_` (dura 1 hora) y uno de
renovación `bkr_` (30 días). El servidor está en `backend/src/lib/oauth/index.ts` y
`backend/src/routes/oauth.ts`. Reglas:

- OAuth nunca concede `admin`, aunque la persona que autoriza sea admin.
- Para escribir, además del scope concedido, la persona tiene que tener un rol de gestión (admin, gerencia,
  operaciones, ejecutiva o líder).
- El registro dinámico de clientes está limitado a 10 por hora por IP.
- Un token se puede revocar con `POST /oauth/revoke`.

---

## MCP Server — tools

Las tools están en `backend/src/lib/mcp/tools/`: `read.ts` (lectura), `write_plans.ts` (planes),
`write_actas.ts` (actas) y `write_confirm.ts` (`confirm_plan`). `backend/src/lib/mcp/server.ts` solo arma el
servidor y revisa permisos.

### Lectura

| Tool | Parámetros | Devuelve |
|---|---|---|
| `list_backlog` | `cliente?`, `owner?`, `estado?`, `semana?` (solo `'actual'`), `mesa?`, `min_dias_atraso?`, `solo_activos?` (por defecto sí), `limite?` (por defecto 50) | Requerimientos filtrados |
| `get_project_status` | `proyecto_id` | Avance ponderado, hitos, bloqueos |
| `get_weekly_signals` | `semana_id?` (uuid; por defecto la actual), `recalcular?` | Señales ordenadas por severidad, con su tema de agenda |
| `get_capacity` | `semana_id?` (uuid) | Carga por persona vs capacidad declarada |
| `get_client_health` | `cliente` (id, slug o nombre) | Proyectos activos, atrasos, días sin movimiento, esperas del cliente |
| `search_requirements` | `query`, `limite?` (por defecto 30) | Búsqueda de texto en títulos internos |
| `list_clients_and_templates` | ninguno | Clientes, plantillas con sus bloques, tipos de pieza y equipo |
| `get_dashboard` | `mesa?` | KPIs de la agencia o de una mesa |
| `get_hours` | `dias?` (por defecto 30) | Horas de Basecamp por cliente y persona, solo números |
| `get_weekly_narrative` | `mesa?` | Status semanal redactado por la IA y agenda agrupada por causa |

`recalcular` en `get_weekly_signals` solo recalcula si la credencial tiene `write:actas`.

### Escritura (patrón preview + confirm)

| Tool | Parámetros | Comportamiento |
|---|---|---|
| `plan_project_from_template` | `plantilla`, `cliente`, `nombre`, `fecha_entrega`, `brief`, `bloques?` | **Devuelve plan, NO ejecuta** |
| `confirm_plan` | `plan_id` | Ejecuta el plan previamente generado |
| `plan_requirement_update` | `requerimiento_id`, `cambios` | Devuelve diff, no aplica |
| `generate_weekly_plan` | `semana_id?`, `mesa` (obligatoria) | Genera el Plan Operativo como borrador interno, no publica |
| `generate_closing_minutes` | `semana_id?`, `mesa` (obligatoria) | Genera el Acta de Cierre como borrador interno, no publica |
| `publish_document` | `acta_id` | **Devuelve plan, NO publica.** `confirm_plan` publica el acta como Message en el board Weekly de su mesa |

Detalles de los parámetros:

- En `plan_project_from_template`, `brief` es un objeto con `objetivo_negocio`, `publico_objetivo`,
  `canales` (al menos uno) y `mandatorios_marca` opcional. Cada elemento de `bloques` indica el bloque, si está
  activo, su responsable y las piezas por canal o por tipo.
- Los responsables (`owners` y el responsable de cada bloque) se buscan por id o por nombre: vale el nombre exacto
  (sin mayúsculas ni tildes) o una sola persona cuyo nombre tenga una palabra que empiece así («Ana» es Ana López,
  nunca Mariana). Si hay más de una o ninguna, no hay plan y el error dice las opciones.
- En `plan_requirement_update`, `cambios` acepta solo estos campos: `estado_operativo`, `estado_aprobacion`,
  `prioridad`, `fecha_entrega`, `motivo_reprogramacion`, `owners` y `piezas`. Cambiar la fecha exige el motivo.
  El preview aplica las mismas reglas que la pantalla (`validarActualizacion` en
  `backend/src/lib/requerimientos/actualizar.ts`): si el cambio no se podrá aplicar, no se ofrece el plan.
- `confirm_plan` solo acepta el plan si lo confirma la misma credencial que lo generó (la misma API key o el
  mismo usuario). El plan expira a los 15 minutos y se puede usar una sola vez.

**El patrón preview + confirm no es opcional.** Un LLM que interpreta mal "crea las tareas
de la campaña de Navidad" puede generar 40 to-dos en el proyecto de producción real de
Cliente Ejemplo.

```typescript
// Ejemplo de respuesta de plan_project_from_template
{
  plan_id: "plan_a1b2c3",
  expira_en: "2026-09-02T21:30:00Z",   // 15 minutos
  resumen: "Crear proyecto 'Campaña Navidad' para Cliente Ejemplo",
  cambios: {
    proyectos_a_crear: 1,
    requerimientos_a_crear: 14,
    todos_basecamp_a_crear: 14,
    visibles_al_cliente: 6
  },
  detalle: [ /* árbol completo */ ],
  advertencias: [
    "Elías quedaría con 8 de 19 tareas en la semana del 14/09 (42%)"
  ]
}
```

---

## Regla crítica de seguridad para MCP

> **El MCP no expone el canal de producción. Ninguna tool devuelve texto de Basecamp.**

El riesgo es concreto: si `get_project_status` devuelve el objeto completo y ese MCP está
conectado a una sesión donde el cliente está presente, o a un GPT compartido, o a un agente
que redacta correos al cliente — el texto interno sale.

Como el texto de Basecamp nunca entra a la base (Defensa 1), esta regla se cumple
estructuralmente. Pero se refuerza explícitamente:

La tool `get_project_status` (en `backend/src/lib/mcp/tools/read.ts`) revisa si la credencial es de perfil
cliente con `esScopeCliente(auth)` (`backend/src/lib/mcp/comun.ts`). Si lo es, solo responde cuando el
proyecto pertenece al cliente de esa key (`auth.clienteId`), y devuelve la vista filtrada de
`sanitizeForClient`. Una key de cliente sin cliente asignado no ve ningún proyecto. El resto de tools de
lectura responden con error a una key de perfil cliente.

Adicional: **no existe tool que devuelva `notas_cuenta` con `visible_cliente = false`
cuando el scope no es interno.**

---

## Conectores por plataforma

| Plataforma | Método | Esfuerzo |
|---|---|---|
| **Claude / Claude Cowork** | MCP nativo (remote server, OAuth) | Directo |
| **ChatGPT** | Conector MCP | Directo, mismo servidor |
| **Gemini** | Adaptador OpenAPI sobre `/api/v1` | ~4 horas, spec autogenerada |
| **PrometIO** | Webhook + consulta REST | Ver [08-prometio.md](./08-prometio.md) |

Para Gemini, la spec OpenAPI 3.1 se sirve en `/api/openapi.json` y se arma en `backend/src/routes/openapi.ts`
con `zod-to-json-schema`. Las entradas usan los mismos esquemas zod con los que validan las rutas; las
respuestas se describen en ese archivo. No se mantiene a mano.

---

## Casos de uso reales

```
Luis (en Claude): "¿cómo va Cliente Ejemplo esta semana?"
  → get_client_health + list_backlog(cliente: "Cliente Ejemplo", semana: actual)

Marcia (en Claude): "prepara la agenda del weekly"
  → get_weekly_signals + get_capacity → agenda ordenada

Ejecutiva: "arma la campaña de Black Friday para Cliente Ejemplo,
            entrega el 20 de noviembre"
  → plan_project_from_template → preview → confirm_plan

Marcia (viernes): "genera el acta de cierre"
  → generate_closing_minutes → revisa → publish_document → confirm_plan
```

---

## Rate limiting y auditoría

- El endpoint `/mcp` admite 100 peticiones por minuto por credencial. El conteo se guarda en Postgres
  (`backend/src/routes/mcp.ts`), así que sobrevive reinicios. Al pasarse responde 429 con `Retry-After`. La API
  REST no tiene este límite.
- Toda llamada de escritura se registra en `audit_log`.
- Los `plan_id` expiran en 15 minutos y son de un solo uso.
- Si una API key ejecuta más de 20 escrituras en 5 minutos, se avisa a los roles `admin` y `operaciones`
  (`backend/src/lib/db/audit.ts`).
