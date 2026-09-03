# 07 · API REST y capa de agentes (MCP)

## Decisión de arquitectura

No se construyen tres integraciones (Claude, Gemini, ChatGPT). Se construye **una capa MCP**
y un adaptador OpenAPI.

```
Claude / Claude Cowork ──┐
ChatGPT (conectores)   ──┤
Gemini (vía OpenAPI)   ──┼──▶ MCP Server ──▶ API REST ──▶ Supabase
PrometIO (CRM)         ──┤
Agentes futuros        ──┘
```

Las tools se escriben una vez. Un modelo nuevo mañana no requiere trabajo adicional.

**Este es el activo diferenciado de BackIO.** No es el código de la tabla; es el conjunto
de tools + plantillas + motor de señales, que encapsula cómo opera una agencia. Ese
conocimiento es de 16 años, no de un sprint.

---

## API REST

Base: `https://backio.geeks.ec/api/v1`
Auth: `Authorization: Bearer {api_key}`

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/clientes` | Lista de clientes |
| GET | `/proyectos` | Filtros: cliente, estado, semana |
| GET | `/proyectos/:id` | Detalle con requerimientos |
| POST | `/proyectos` | Crear desde plantilla |
| GET | `/requerimientos` | Backlog filtrado |
| POST | `/requerimientos` | Crear requerimiento |
| PATCH | `/requerimientos/:id` | Actualizar |
| POST | `/requerimientos/bulk` | Carga masiva |
| GET | `/semanas/:id/senales` | Señales de la semana |
| GET | `/semanas/:id/capacidad` | Carga por persona |
| POST | `/semanas/:id/plan` | Generar Plan Operativo |
| POST | `/semanas/:id/acta` | Generar Acta de Cierre |
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

Las API keys se almacenan hasheadas. Se muestran una sola vez al crearlas.

---

## MCP Server — tools

### Lectura

| Tool | Parámetros | Devuelve |
|---|---|---|
| `list_backlog` | `cliente?`, `semana?`, `owner?`, `estado?`, `min_dias_atraso?` | Requerimientos filtrados |
| `get_project_status` | `proyecto_id` | Avance ponderado, hitos, bloqueos |
| `get_weekly_signals` | `semana?` (default: actual) | Señales ordenadas por severidad |
| `get_capacity` | `semana?` | Carga por persona vs capacidad declarada |
| `get_client_health` | `cliente_id` | Días sin movimiento, atrasos, proyectos activos |
| `search_requirements` | `query` | Búsqueda de texto en títulos internos |

### Escritura (patrón preview + confirm)

| Tool | Parámetros | Comportamiento |
|---|---|---|
| `plan_project_from_template` | `plantilla`, `cliente`, `brief`, `fecha_entrega` | **Devuelve plan, NO ejecuta** |
| `confirm_plan` | `plan_id` | Ejecuta el plan previamente generado |
| `plan_requirement_update` | `requerimiento_id`, `cambios` | Devuelve diff, no aplica |
| `generate_weekly_plan` | `semana` | Genera doc, no publica |
| `generate_closing_minutes` | `semana` | Genera doc, no publica |
| `publish_document` | `acta_id` | Publica en Basecamp |

**El patrón preview + confirm no es opcional.** Un LLM que interpreta mal "crea las tareas
de la campaña de Navidad" puede generar 40 to-dos en el proyecto de producción real de
Banco Amazonas.

```typescript
// Ejemplo de respuesta de plan_project_from_template
{
  plan_id: "plan_a1b2c3",
  expira_en: "2026-09-02T21:30:00Z",   // 15 minutos
  resumen: "Crear proyecto 'Campaña Navidad' para Banco Amazonas",
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

```typescript
// lib/mcp/tools/getProjectStatus.ts
// Toda tool que pueda ejecutarse en contexto compartido usa el sanitizador
// cuando el scope de la key no es interno.

export async function getProjectStatus({ proyecto_id }, ctx: MCPContext) {
  const p = await db.getProyecto(proyecto_id, ctx.tenant_id);
  const reqs = await db.getRequerimientos(proyecto_id, ctx.tenant_id);

  if (ctx.scope === 'cliente') return sanitizeForClient(p, reqs);
  return internalProjectView(p, reqs);   // sin texto de Basecamp, por construcción
}
```

Adicional: **no existe tool que devuelva `notas_cuenta` con `visible_cliente = false`
cuando el scope no es interno.**

---

## Conectores por plataforma

| Plataforma | Método | Esfuerzo |
|---|---|---|
| **Claude / Claude Cowork** | MCP nativo (remote server, OAuth) | Directo |
| **ChatGPT** | Conector MCP | Directo, mismo servidor |
| **Gemini** | Adaptador OpenAPI sobre `/api/v1` | ~4 horas, spec autogenerada |
| **PrometIO** | Webhook + API key con scope acotado | Ver `08-prometio.md` |

Para Gemini, la spec OpenAPI 3.1 se genera desde los mismos handlers con `zod-to-openapi`.
No se mantiene a mano.

---

## Casos de uso reales

```
Luis (en Claude): "¿cómo va Banco Amazonas esta semana?"
  → get_client_health + list_backlog(cliente: BASA, semana: actual)

Marcia (en Claude): "prepara la agenda del weekly"
  → get_weekly_signals + get_capacity → agenda ordenada

Ejecutiva: "arma la campaña de Black Friday para Banco Amazonas,
            entrega el 20 de noviembre"
  → plan_project_from_template → preview → confirm_plan

Marcia (viernes): "genera el acta de cierre"
  → generate_closing_minutes → revisa → publish_document
```

---

## Rate limiting y auditoría

- 100 req/min por API key
- Toda llamada de escritura se registra en `audit_log`: key, tool, parámetros, resultado
- Los `plan_id` expiran en 15 minutos y son de un solo uso
- Alerta a admin si una key ejecuta >20 escrituras en 5 minutos
