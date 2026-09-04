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

## Claude Desktop / claude.ai (conector remoto)

Settings → Connectors → Add custom connector → URL `https://backiobackend-production.up.railway.app/mcp`.
Si el conector exige OAuth y no permite cabeceras, usar por ahora Claude Code o un cliente que
soporte `Authorization`. El OAuth del MCP queda como pendiente de Fase 2.7.

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
