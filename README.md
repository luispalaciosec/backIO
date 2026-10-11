# BackIO

**Sistema operativo de backlog de Geeks Ecuador.** Reemplaza Monday.com como tablero de
requerimientos y vista de cuenta del cliente, apoyándose en Basecamp como sistema de ejecución.

En producción desde el 04/09/2026 · `backio.vercel.app` · sincronizado con Basecamp.

## Qué hace

| Para | Qué resuelve |
|---|---|
| **Ejecutivas de cuenta** | Backlog por cliente estilo Monday (filtros en la URL, columnas fijas, edición en línea), bitácora con el cliente, hoja de estatus imprimible, reprogramaciones con motivo, reprocesos |
| **Mesas de operación** | Daily por mesa (elegir tareas, tablero, apertura y cierre publicados en Basecamp con menciones y métricas), Weekly con motor de señales, Plan Operativo y Acta de Cierre |
| **Gerencia** | Dashboard, cumplimiento a fecha original vs vigente, personas (performance con evidencia del timesheet), informes mensuales y por canal |
| **Clientes** | Portal por token con lo que la agencia decidió mostrar. Nada interno puede llegar ahí por diseño |
| **Agentes de IA** | API REST con scopes y MCP Server con preview + confirmación para toda escritura |

Basecamp sigue siendo donde el equipo trabaja. BackIO lee de ahí solo lo estructural (títulos,
fechas, responsables, completado, horas) y escribe de vuelta fechas, to-dos nuevos y mensajes.

## Las cinco reglas que nunca se rompen

1. **El texto de Basecamp jamás entra a BackIO.** Descripciones, comentarios y adjuntos se quedan
   allá. Solo entran títulos (excepción D1), fechas, responsables, completado y horas. Es la
   garantía estructural de que un comentario interno no llegue al cliente.
2. **La visibilidad al cliente se hereda, nunca se abre.** Un trigger de base de datos impide
   pasar de oculto a visible.
3. **Los estados no se sincronizan en dos direcciones.** Basecamp manda sobre `completed`;
   BackIO sobre todo lo demás.
4. **Toda escritura desde un agente requiere preview + confirmación.**
5. **`tenant_id` y RLS en toda tabla**, aunque hoy solo exista un tenant.

Detalle y defensas en `docs/02-visibilidad.md`. Zonas que no se cambian sin revisión humana:
`lib/visibility/`, `lib/basecamp/write.ts`, tools MCP de escritura y políticas RLS (`CLAUDE.md`).

## Stack

| Capa | Tecnología |
|---|---|
| Base de datos y auth | Supabase (Postgres + RLS + Auth) |
| Backend | Hono sobre Node 22, TypeScript estricto, zod · Railway |
| Frontend | Next.js 15.5 (App Router) + React 19 + Tailwind · Vercel |
| Ejecución | Basecamp 3 API (OAuth2, webhooks, polling) |
| CRM | PrometIO (webhook, `cliente_id` compartido) |
| IA | Claude (Anthropic API): redacta dailies, weeklies, briefs e informes; una persona publica |
| Agentes | MCP Server + API REST con OpenAPI |
| Operación | Logger JSON con niveles, Sentry sin datos personales (opcional), Turnstile en login y recuperar contraseña |
| CI | GitHub Actions: `pnpm audit`, typecheck, lint, tests y build en cada push; Dependabot semanal |

## Correr en local

```bash
pnpm install
cp backend/.env.example backend/.env      # Supabase, Basecamp, Anthropic, Resend
cp frontend/.env.example frontend/.env.local
pnpm dev                                   # backend :4000 · frontend :3000
pnpm test && pnpm typecheck && pnpm lint
```

Requisitos, variables, base de datos, usuarios y API keys: `docs/11-setup.md`. Despliegue:
`docs/12-despliegue.md`.

## Estructura

```
shared/     tipos compartidos y sanitizeForClient (única salida al cliente)
backend/    src/app.ts (routers) · src/routes/v1 · src/lib (dominio, db, basecamp, ia, mcp)
            supabase/migrations (SQL versionado, 01–29) · scripts (operación)
frontend/   app/(app) área interna · app/p portal · components · lib
docs/       sitio VitePress: specs, arquitectura técnica, operación, decisiones, manual de uso (HTML + PDF)
```

Cómo está armado por dentro, ciclo de una petición, crons, integraciones y deuda técnica:
**`docs/17-arquitectura-tecnica.md`**.

## Documentación

La carpeta `docs/` es un sitio VitePress publicado en **https://backio.vercel.app/docs** (se compila junto con el
frontend). Para leerlo en local mientras se edita:

```bash
pnpm --filter @backio/docs dev
```

Se empieza por `docs/empezar.md`. Los documentos que más se consultan:

| Doc | Contenido |
|---|---|
| `CLAUDE.md` | Reglas, convenciones, zonas de revisión humana |
| `docs/02-visibilidad.md` | Frontera cliente/interno. Léelo antes de tocar el portal o la sincronización |
| `docs/17-arquitectura-tecnica.md` | Arquitectura a nivel de código y deuda técnica |
| `docs/operacion.md` | Qué corre solo, qué hacer cuando algo falla, tareas de rutina |
| `docs/decisiones.md` | Registro de decisiones vigentes |
| `docs/18-seguridad.md` | Revisiones de seguridad: hallazgos, correcciones y pendientes |
| `HARDENING-CHANGELOG.md` | Detalle, hallazgo por hallazgo, de la auditoría externa del 10/10/2026 |
| `docs/manual/` | Manual de uso para el equipo (HTML y PDF con pantallas) |

## Estado y deuda técnica

Fases 0 a 4 y sprints v2 1 a 4 en producción. Ya están el CI en GitHub Actions, el vigía que avisa si una tarea
programada no corre y el despliegue automático del frontend (requiere el secreto `VERCEL_TOKEN`). Pendiente de
plataforma: ambiente de staging y tests de integración con Basecamp. Lista completa y priorizada en
`docs/17-arquitectura-tecnica.md` §8.

## Decisiones vigentes

| Decisión | Resultado |
|---|---|
| Product owner | Marcia (jefa de operaciones) |
| Basecamp como origen de trabajo | **Aceptado (23/09/2026).** Lo creado allá entra solo en segundos por el webhook, con una pasada de respaldo cada 15 min; la ejecutiva clasifica en «Entradas desde Basecamp» |
| Colaboradores | Editan solo sus tareas (estado, fecha con motivo, entregables, piezas, daily) |
| Daily | Es de una mesa; ninguna tarea entra sin responsable |
| Canal de notificación | Correo |
| Todo SQL | Archivo numerado en `backend/supabase/migrations/`, lo aplica Luis |

## Riesgo #1

**Fuga de contenido interno al cliente.** Un comentario de dirección de arte visible en el portal
es la pérdida de una cuenta. Mitigación: las tres defensas de `docs/02-visibilidad.md`, tests que
las protegen (`sanitize.test.ts`, `sync.test.ts`, `portal.test.ts`, entre otros) y revisión humana obligatoria
en las zonas listadas arriba.
