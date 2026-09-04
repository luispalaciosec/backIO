# 11 · Setup y estructura del repositorio

## Estructura

```
backIO/
  shared/            Tipos de dominio + contratos API + sanitizeForClient (única función de salida al cliente)
  backend/           API Hono/TypeScript + migraciones Supabase
    supabase/
      migrations/    SQL versionado (Fase 0)
      seed.sql       Tenant Geeks + 5 plantillas + mapeo de servicios
    src/
      lib/db/        ÚNICA capa que toca Supabase
      lib/auth/      JWT Supabase (UI) o API key con scopes (agentes, PrometIO)
      lib/builder/   Plan de proyecto (pesos, fechas hacia atrás, alerta de carga) + import CSV
      lib/basecamp/  sync.ts (extracción estricta) · client.ts · write.ts (zona de revisión) · reconcile.ts
      lib/rituals/   Motor de señales · Daily · Plan Operativo · Acta de Cierre
      lib/portal/    Token firmado · resumen ejecutivo IA (Claude)
      lib/visibility/ Re-export de shared + guard (zona de revisión)
      routes/        /api/v1 · /api/portal · /api/webhooks · /api/cron
  frontend/          Next.js 14 App Router + Tailwind
    app/(app)/       backlog · proyectos · proyectos/nuevo (Builder 5 pasos) · proyectos/importar · daily · weekly
    app/p/[token]/   Portal cliente público (consume /api/portal)
    lib/api.ts       Cliente HTTP al backend (token de sesión Supabase, sin localStorage)
```

Backend y frontend son despliegues independientes. El frontend nunca consulta Supabase
para datos de negocio: solo para autenticación. Toda lectura/escritura va por el backend.

## Variables de entorno

Copiar `.env.example` a `backend/.env` y `frontend/.env.local` y completar. Ver comentarios en cada uno.

## Correr en local

```bash
pnpm install
pnpm --filter @backio/backend dev     # http://localhost:4000
pnpm --filter @backio/frontend dev    # http://localhost:3000
```

## Base de datos

Migraciones en `backend/supabase/migrations`. Aplicar en orden con el CLI de Supabase
(`supabase link --project-ref gckjyjvqvdfayjrtfbmj && supabase db push`) o con el MCP.

| Migración | Contenido | Revisión humana |
|---|---|---|
| `…0001_fase0_schema.sql` | Tablas, enums, helpers `auth_*()`, RLS ON sin políticas (deny-all) | No |
| `…0002_fase0_rls.sql` | Políticas RLS por tabla | **Sí** (CLAUDE.md) |
| `…0003_fase0_triggers_vistas_indices.sql` | Trigger visibilidad monotónica, auditoría de reprogramación, vistas, índices | No |
| `…0004_fase0_api_keys_audit.sql` | API keys, audit_log, planes de agente, caché de resumen, notificaciones | No |
| `seed.sql` | Tenant Geeks, 5 plantillas, mapeo servicios | No |

**Estado al 2026-09-03:** las cuatro migraciones y el seed están aplicados en
`gckjyjvqvdfayjrtfbmj`. Las 0001 y 0003 se aplicaron vía MCP (quedan registradas en
`supabase_migrations`); la 0002, la 0004 y el seed se ejecutaron desde el SQL Editor. Antes
del primer `supabase db push` desde el CLI, marcarlas como aplicadas para que no intente
repetirlas:

```bash
npx supabase migration repair --status applied 20260903000002 20260903000004
```

## Usuarios

Al crear un usuario en Supabase Auth (Dashboard → Authentication → Users → Add user), un
trigger crea su fila en `usuarios` automáticamente:

- Si existe una **invitación** para ese email, toma nombre, rol y capacidad de ahí.
- Si no, y el dominio del correo está en `tenants.dominios_auto` (`geeks.com.ec`, `geeks.ec`),
  entra como `colaborador`.
- Cualquier otro dominio no recibe acceso.

Para dar un rol distinto de colaborador, crear la invitación ANTES del usuario en Auth:

```sql
insert into invitaciones (tenant_id, email, nombre, rol)
values ('00000000-0000-4000-8000-000000000001', 'persona@geeks.com.ec', 'Nombre Apellido', 'ejecutiva');
```

Roles: `admin`, `gerencia`, `operaciones`, `ejecutiva`, `lider`, `colaborador`. Para cambiar
el rol de alguien que ya existe: `update usuarios set rol = 'lider' where email = '...'`.

## API keys

Las keys empiezan con `bk_` y se guardan hasheadas (sha256). Para crear una:

```sql
-- key = 'bk_live_' || 40 chars aleatorios; guardar sha256(key)
insert into api_keys (tenant_id, nombre, prefijo, key_hash, scopes, perfil)
values ('00000000-0000-4000-8000-000000000001', 'PrometIO', 'bk_live_', encode(sha256('bk_live_XXXX'::bytea), 'hex'),
        array['read:proyectos','write:proyectos'], 'prometio');
```

## Verificación obligatoria de Fase 0 (docs/09)

- [ ] Migraciones aplicadas
- [ ] RLS: usuario de tenant B lee 0 filas del tenant Geeks
- [ ] Clientes migrados desde PrometIO con IDs idénticos
- [ ] `basecamp_project_id` poblado para clientes activos
- [ ] Trigger de visibilidad monotónica probado (`update requerimientos set visible_cliente = true` falla)
