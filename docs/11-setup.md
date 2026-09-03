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

Sin la migración 0002 el frontend (rol `authenticated`) no puede leer nada: RLS está
encendida y no hay políticas. El backend con service role sí opera.

## Primer usuario

1. Crear el usuario en Supabase Auth (Dashboard → Authentication → Users).
2. Insertar su fila en `usuarios` con el `tenant_id` de Geeks (`00000000-0000-4000-8000-000000000001`) y rol `admin`.

```sql
insert into usuarios (id, tenant_id, nombre, email, rol)
values ('<uuid de auth.users>', '00000000-0000-4000-8000-000000000001', 'Luis Palacios', 'luis@geeks.ec', 'admin');
```

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
