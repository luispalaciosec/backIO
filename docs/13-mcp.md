# 13 · Conectar agentes al MCP Server

Endpoint: `https://backiobackend-production.up.railway.app/mcp` (Streamable HTTP, sin estado).
Auth: `Authorization: Bearer bk_live_…` con una API key creada en Admin → API keys.

| Perfil de key | Tools disponibles |
|---|---|
| gerencial | todas las de lectura |
| ejecutiva | lectura + `plan_requirement_update` / `confirm_plan` |
| operaciones | lectura + escritura completa (proyectos, requerimientos, actas, publicar) |
| cliente | solo `get_project_status` (sanitizado) y `get_client_health` (con etiquetas cliente) |

## Tools

**Lectura**: `list_backlog`, `get_project_status`, `get_weekly_signals`, `get_capacity`,
`get_client_health`, `search_requirements`, `list_clients_and_templates`.

**Escritura (preview + confirm)**: `plan_project_from_template` → `confirm_plan`,
`plan_requirement_update` → `confirm_plan`, `generate_weekly_plan`, `generate_closing_minutes`,
`publish_document`. Los `plan_id` expiran en 15 minutos y son de un solo uso.

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
acceso de 1 hora con refresh de 30 días, guardados hasheados. PKCE S256 obligatorio.

## OpenAPI (Gemini y clientes REST)

`https://backiobackend-production.up.railway.app/api/openapi.json` — OpenAPI 3.1 generada desde los
mismos esquemas zod de las rutas. En Gemini: crear una herramienta con esa spec y auth Bearer con
una API key de BackIO.

## Publicar actas en Basecamp

`publish_document` crea un Documento en el proyecto Basecamp de operaciones. Configurar una vez:

```sql
update tenants set config = config || '{"basecamp_docs_project_id": 12345678}' where slug = 'geeks';
```

## Ejemplos de uso

- "¿Cómo va Banco Amazonas esta semana?" → `get_client_health` + `list_backlog(cliente, semana: actual)`
- "Prepara la agenda del weekly" → `get_weekly_signals` + `get_capacity`
- "Arma la campaña de Black Friday para Banco Amazonas, entrega 20 de noviembre" → `list_clients_and_templates` → `plan_project_from_template` → revisar → `confirm_plan`
- "Genera el acta de cierre" → `generate_closing_minutes` → revisar → `publish_document`
