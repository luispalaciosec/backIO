# 13 · Conectar agentes al MCP Server

> Revisado contra el código el 11/10/2026.

Endpoint: `https://backiobackend-production.up.railway.app/mcp` (Streamable HTTP, sin estado).
Auth: `Authorization: Bearer bk_live_…` con una API key creada en Admin → API keys.

| Perfil de key | Tools disponibles |
|---|---|
| gerencial | todas las de lectura |
| ejecutiva | lectura + `plan_requirement_update` / `confirm_plan` |
| operaciones | lectura + escritura completa (proyectos, requerimientos, actas, publicar) |
| prometio | lectura de proyectos (`get_project_status`, `get_client_health`, `list_clients_and_templates`) + `plan_project_from_template` / `confirm_plan` |
| cliente | solo `get_project_status`, sanitizado y únicamente para proyectos del cliente asignado a la key |
| custom | las que permitan los scopes elegidos al crear la key |

Una key de perfil cliente recibe error en cualquier otra tool, incluida `get_client_health`. Tampoco
puede usar la API REST. Ver los perfiles y scopes en [07-api-mcp.md](./07-api-mcp.md#scopes-de-api-key).

## Tools

**Lectura**: `list_backlog`, `get_project_status`, `get_weekly_signals`, `get_capacity`,
`get_client_health`, `search_requirements`, `list_clients_and_templates`, `get_dashboard`, `get_hours`,
`get_weekly_narrative`.

**Escritura (preview + confirm)**: `plan_project_from_template` → `confirm_plan`,
`plan_requirement_update` → `confirm_plan`, `generate_weekly_plan`, `generate_closing_minutes`,
`publish_document`. `generate_weekly_plan` y `generate_closing_minutes` exigen el parámetro `mesa`. Los
`plan_id` expiran en 15 minutos, son de un solo uso y solo los puede confirmar la misma credencial que los
generó.

Los parámetros de cada tool están en [07-api-mcp.md](./07-api-mcp.md) y las rutas REST en la
[referencia de la API](./referencia-api.md).

Ninguna tool devuelve texto de Basecamp: ese texto nunca entra a la base.

## Claude Code

```bash
claude mcp add --transport http backio https://backiobackend-production.up.railway.app/mcp --header "Authorization: Bearer bk_live_XXXX"
```

## Claude Desktop / claude.ai (conector remoto, OAuth)

Settings → Connectors → Add custom connector → URL `https://backiobackend-production.up.railway.app/mcp`.
El cliente descubre `/.well-known/oauth-protected-resource`, se registra solo (RFC 7591), y al
autorizar te lleva a `backio.vercel.app/oauth/consent` con tu sesión de BackIO. El token resultante
actúa con tu usuario y tu rol; los scopes se muestran en la pantalla de consentimiento. Tokens de
acceso de 1 hora (`bko_…`) con refresh de 30 días (`bkr_…`), guardados hasheados. PKCE S256 obligatorio.

- OAuth nunca concede `admin`. Para escribir hace falta el scope concedido y, además, que tu rol sea de
  gestión (admin, gerencia, operaciones, ejecutiva o líder).
- El registro dinámico de clientes admite 10 registros por hora por IP.
- Un token se revoca con `POST /oauth/revoke`.

## OpenAPI (Gemini y clientes REST)

`https://backiobackend-production.up.railway.app/api/openapi.json` — OpenAPI 3.1 generada desde los
mismos esquemas zod de las rutas. En Gemini: crear una herramienta con esa spec y auth Bearer con
una API key de BackIO.

## Límites y alertas

- 100 peticiones por minuto por credencial. Al pasarse, `/mcp` responde 429 con el encabezado `Retry-After`.
- Si una API key hace más de 20 escrituras en 5 minutos, se avisa a admin y operaciones.

## Publicar actas en Basecamp

Como `generate_*` exige mesa, el acta se publica como Message en el board Weekly de esa mesa: `publish_document`
devuelve un plan y `confirm_plan` publica.
La mesa necesita tener configurados `basecamp_project_id` y `basecamp_board_weekly_id` (Admin → Mesas →
Detectar boards).

`tenants.config.basecamp_docs_project_id` solo se usa para actas sin mesa, que se publican como Doc. Esas
actas se generan desde la pantalla o la API REST sin `?mesa=`, no desde el MCP:

```sql
update tenants set config = config || '{"basecamp_docs_project_id": 12345678}' where slug = 'geeks';
```

## Ejemplos de uso

- "¿Cómo va Cliente Ejemplo esta semana?" → `get_client_health` + `list_backlog(cliente, semana: actual)`
- "Prepara la agenda del weekly" → `get_weekly_signals` + `get_capacity`
- "Arma la campaña de Black Friday para Cliente Ejemplo, entrega 20 de noviembre" → `list_clients_and_templates` → `plan_project_from_template` → revisar → `confirm_plan`
- "Genera el acta de cierre" → `generate_closing_minutes` → revisar → `publish_document` → `confirm_plan`
